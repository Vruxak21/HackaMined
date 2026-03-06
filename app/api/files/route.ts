import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requireAdmin, requireAuth, logAction } from "@/lib/auth-helper";
import prisma from "@/lib/db";
import { enqueueJob } from "@/lib/job-queue";
import { signBody } from "@/lib/hmac";
import { callPythonService } from "@/lib/service-auth";
import { createFile, updateFileAfterProcessing, getFileList } from "@/lib/db-encrypted";

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

    // Step 2: Call the Python service (120 s timeout, HMAC-signed)
    let res: Response;
    try {
      res = await callPythonService("/process", {
        file_path: tmpPath,
        output_path: outPath,
        file_type: ext,
        mode,
      });
    } catch (fetchErr) {
      if (fetchErr instanceof Error && fetchErr.message === "Python service timeout") {
        throw new Error("Processing timeout — file may be too large");
      }
      throw fetchErr;
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

    // Step 3: Read sanitized output and persist (encrypted via db-encrypted)
    const sanitizedBase64 = (await readFile(outPath)).toString("base64");

    await updateFileAfterProcessing(fileId, {
      sanitizedContent: sanitizedBase64,
      piiSummary: result.pii_summary ?? {},
      totalPiiFound: result.total_pii ?? 0,
      layerBreakdown: result.layer_breakdown ?? {},
      confidenceBreakdown: result.confidence_breakdown ?? {},
      processedAt: new Date(),
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

  // 5. Create the File record in PROCESSING state (originalContent encrypted via db-encrypted)
  const dbFile = await createFile({
    originalName: file.name,
    fileType: ext,
    originalContent: base64,
    maskingMode: mode,
    uploadedBy: user.id,
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

  // 8. Return immediately with the created record (strip content blobs and key metadata)
  const { originalContent: _oc, sanitizedContent: _sc, encryptionKeyVersion: _kv, ...safeFile } = dbFile as Record<string, unknown>;
  return NextResponse.json({ file: safeFile, ...(warning ? { warning } : {}) }, { status: 201 });
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
    const files = await getFileList();
    const parsed = files.map(({ encryptionKeyVersion: _, ...f }) => f);
    return NextResponse.json({ files: parsed });
  }

  // USER: only DONE files, minimal safe fields (no content, no uploader info)
  const files = await getFileList({ status: "DONE" });
  const safeFiles = files.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    fileType: f.fileType,
    status: f.status,
    totalPiiFound: f.totalPiiFound,
    uploadedAt: f.uploadedAt,
    processedAt: f.processedAt,
  }));

  return NextResponse.json({ files: safeFiles });
}
