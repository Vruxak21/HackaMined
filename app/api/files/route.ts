import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requireAdmin, requireAuth, logAction } from "@/lib/auth-helper";
import prisma from "@/lib/db";
import { enqueueJob } from "@/lib/job-queue";

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "docx", "doc", "sql", "csv", "txt", "json", "png", "jpg", "jpeg",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Helper: detect Next.js redirect errors thrown by requireAdmin/requireAuth
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// ── Background processing ──────────────────────────────────────────────────

async function processFileInBackground(
  fileId: string,
  base64: string,
  ext: string,
  mode: string,
  userId: string,
): Promise<void> {
  const tmpPath = join(tmpdir(), `${fileId}.${ext}`);
  const outPath = join(tmpdir(), `${fileId}_sanitized.${ext}`);

  try {
    // Step 1: Write decoded bytes to a temp file
    await writeFile(tmpPath, Buffer.from(base64, "base64"));

    // Step 2: Call the Python service (120 s timeout)
    const pythonUrl =
      process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    let res: Response;
    try {
      res = await fetch(`${pythonUrl}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: tmpPath,
          output_path: outPath,
          file_type: ext,
          mode,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        throw new Error("Processing timeout — file may be too large");
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      throw new Error(`Python service returned HTTP ${res.status}`);
    }

    const result: {
      success: boolean;
      pii_summary?: Record<string, number>;
      total_pii?: number;
      layer_breakdown?: Record<string, number>;
      confidence_breakdown?: Record<string, number>;
    } = await res.json();

    if (!result.success) {
      throw new Error("Python service reported a processing failure");
    }

    // Step 3: Read sanitized output and persist
    const sanitizedBase64 = (await readFile(outPath)).toString("base64");

    await prisma.file.update({
      where: { id: fileId },
      data: {
        status: "DONE",
        sanitizedContent: sanitizedBase64,
        piiSummary: JSON.stringify(result.pii_summary ?? {}),
        totalPiiFound: result.total_pii ?? 0,
        layerBreakdown: JSON.stringify(result.layer_breakdown ?? {}),
        confidenceBreakdown: JSON.stringify(result.confidence_breakdown ?? {}),
        processedAt: new Date(),
      },
    });

    await logAction({
      userId,
      action: "SCAN",
      fileId,
      detail: `Found ${result.total_pii ?? 0} PII instances`,
    });
  } catch (err) {
    // Mark as failed and log the error detail
    await prisma.file
      .update({ where: { id: fileId }, data: { status: "FAILED" } })
      .catch(() => {});

    await logAction({
      userId,
      action: "SCAN",
      fileId,
      detail: `Processing failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    // Clean up temp files regardless of outcome
    await unlink(tmpPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// ── POST /api/files — File Upload ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Admin-only
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin();
  } catch (err) {
    if (isRedirectError(err)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  // 2. Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileEntry = formData.get("file");
  const mode = (formData.get("mode") as string | null) ?? "redact";

  // 3. Validate file presence
  if (!fileEntry || typeof fileEntry === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const file = fileEntry as File;

  // 3a. Validate extension
  const nameParts = file.name.split(".");
  const ext = nameParts.length > 1 ? nameParts.at(-1)!.toLowerCase() : "";

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      {
        error: `File type ".${ext}" is not supported. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // 3b. Validate size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File size exceeds the 10 MB limit" },
      { status: 400 },
    );
  }

  // 4. Convert to base64
  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");

  // 5. Create the File record in PROCESSING state
  const dbFile = await prisma.file.create({
    data: {
      originalName: file.name,
      fileType: ext,
      status: "PROCESSING",
      originalContent: base64,
      maskingMode: mode,
      uploadedBy: user.id,
    },
  });

  // 6. Log UPLOAD action
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;

  await logAction({
    userId: user.id,
    action: "UPLOAD",
    fileId: dbFile.id,
    detail: `Uploaded ${file.name}`,
    ipAddress: ip,
  });

  // 7. Enqueue background processing (job queue keeps the event loop alive)
  enqueueJob(() => processFileInBackground(dbFile.id, base64, ext, mode, user.id));

  const WARN_SIZE = 5 * 1024 * 1024; // 5 MB
  const warning =
    file.size > WARN_SIZE
      ? `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Processing may be slow for large files.`
      : undefined;

  // 8. Return immediately with the created record
  return NextResponse.json({ file: dbFile, ...(warning ? { warning } : {}) }, { status: 201 });
}

// ── GET /api/files — File List ─────────────────────────────────────────────

export async function GET() {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth();
  } catch (err) {
    if (isRedirectError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  if (user.role === "ADMIN") {
    const files = await prisma.file.findMany({
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        originalName: true,
        fileType: true,
        status: true,
        maskingMode: true,
        piiSummary: true,
        totalPiiFound: true,
        layerBreakdown: true,
        confidenceBreakdown: true,
        uploadedBy: true,
        uploadedAt: true,
        processedAt: true,
        uploader: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    const parsed = files.map((f) => ({
      ...f,
      piiSummary: f.piiSummary ? JSON.parse(f.piiSummary) : null,
      layerBreakdown: f.layerBreakdown ? JSON.parse(f.layerBreakdown) : null,
      confidenceBreakdown: f.confidenceBreakdown
        ? JSON.parse(f.confidenceBreakdown)
        : null,
    }));

    return NextResponse.json({ files: parsed });
  }

  // USER: only DONE files, minimal safe fields (no content, no uploader info)
  const files = await prisma.file.findMany({
    where: { status: "DONE" },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      originalName: true,
      fileType: true,
      status: true,
      totalPiiFound: true,
      uploadedAt: true,
      processedAt: true,
    },
  });

  return NextResponse.json({ files });
}
