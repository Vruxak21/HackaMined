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
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  LARGE_FILE_THRESHOLD_BYTES,
  POLL_INTERVAL_MS,
  MAX_POLL_ATTEMPTS,
} from "@/lib/constants";

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "docx", "doc", "sql", "csv", "txt", "json", "png", "jpg", "jpeg",
]);

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

    // Step 2: Start Python processing — returns immediately with {started: true}.
    // Python runs the job in a background thread and exposes progress via
    // GET /process-status/{id}, so we never hold an HTTP connection open for
    // the full processing duration (avoids the 600-second timeout issue).
    const startRes = await callPythonService("/process", {
      file_path: tmpPath,
      output_path: outPath,
      file_type: ext,
      mode,
      job_id: fileId,
    }, 30_000);  // 30 s just to start the job

    if (!startRes.ok) {
      const errText = await startRes.text().catch(() => "");
      throw new Error(`Python service returned HTTP ${startRes.status}: ${errText}`);
    }
    const started = await startRes.json() as { started: boolean };
    if (!started.started) {
      throw new Error("Python service failed to start processing");
    }

    // Step 3: Poll /process-status until the job reports finished=true.
    const baseUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
    const MAX_WAIT_MS   = MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS; // ~10 min
    const startTime     = Date.now();

    type StatusResponse = {
      finished: boolean;
      success?: boolean;
      error?: string;
      pii_summary?: Record<string, number>;
      total_pii?: number;
      layer_breakdown?: Record<string, number>;
      confidence_breakdown?: Record<string, number>;
      processing_info?: Record<string, unknown>;
    };

    let finalStatus: StatusResponse | null = null;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const pollRes = await fetch(
          `${baseUrl}/process-status/${encodeURIComponent(fileId)}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!pollRes.ok) continue;
        const status = await pollRes.json() as StatusResponse;
        if (status.finished) {
          finalStatus = status;
          break;
        }
      } catch {
        // Transient error — keep polling
      }
    }

    if (!finalStatus) {
      throw new Error("Processing timed out");
    }
    if (!finalStatus.success) {
      throw new Error(finalStatus.error ?? "Processing failed");
    }

    // Step 4: Read the sanitized output file Python wrote, persist encrypted
    const sanitizedBase64 = (await readFile(outPath)).toString("base64");

    await updateFileAfterProcessing(fileId, {
      sanitizedContent: sanitizedBase64,
      piiSummary: finalStatus.pii_summary ?? {},
      totalPiiFound: finalStatus.total_pii ?? 0,
      layerBreakdown: finalStatus.layer_breakdown ?? {},
      confidenceBreakdown: finalStatus.confidence_breakdown ?? {},
      processingInfo: finalStatus.processing_info,
      processedAt: new Date(),
    });

    await logAction({
      userId,
      action: "SCAN",
      fileId,
      detail: `Found ${finalStatus.total_pii ?? 0} PII instances`,
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
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE_LABEL}.` },
      { status: 413 },
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

  const warning =
    file.size > LARGE_FILE_THRESHOLD_BYTES
      ? `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Processing may be slow for large files.`
      : undefined;

  // 8. Return immediately with the created record (strip content blobs and key metadata)
  const { originalContent: _oc, sanitizedContent: _sc, encryptionKeyVersion: _kv, ...safeFile } = dbFile as Record<string, unknown>;
  return NextResponse.json({ file: safeFile, ...(warning ? { warning } : {}) }, { status: 201 });
}

// ── GET /api/files — File List ─────────────────────────────────────────────

const USER_PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
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

  // USER: paginated with server-side filtering
  const url       = new URL(req.url);
  const page      = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const q         = url.searchParams.get("q")?.trim() ?? "";
  const fileType  = url.searchParams.get("fileType")  ?? "all";
  const dateRange = url.searchParams.get("dateRange") ?? "all";
  const piiRange  = url.searchParams.get("piiRange")  ?? "any";
  const sort      = url.searchParams.get("sort")      ?? "newest";

  // Build Prisma where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { status: "DONE" };

  if (q) {
    where.originalName = { contains: q, mode: "insensitive" };
  }

  if (fileType !== "all") {
    where.fileType =
      fileType === "image"
        ? { in: ["png", "jpg", "jpeg"] }
        : fileType;
  }

  if (dateRange !== "all") {
    const daysMap: Record<string, number> = { "7d": 7, "30d": 30, "3m": 90, "1y": 365 };
    const days = daysMap[dateRange];
    if (days) {
      where.processedAt = { gte: new Date(Date.now() - days * 86_400_000) };
    }
  }

  if (piiRange !== "any") {
    if (piiRange === "none")   where.totalPiiFound = 0;
    if (piiRange === "low")    where.totalPiiFound = { gte: 1,  lte: 10 };
    if (piiRange === "medium") where.totalPiiFound = { gte: 11, lte: 50 };
    if (piiRange === "high")   where.totalPiiFound = { gte: 51 };
  }

  // Build Prisma orderBy
  const orderByMap: Record<string, object> = {
    newest:      { processedAt: "desc" },
    oldest:      { processedAt: "asc"  },
    "pii-desc":  { totalPiiFound: "desc" },
    "pii-asc":   { totalPiiFound: "asc"  },
    "name-az":   { originalName: "asc"  },
    "name-za":   { originalName: "desc" },
  };
  const orderBy = orderByMap[sort] ?? { processedAt: "desc" };

  const skip = (page - 1) * USER_PAGE_SIZE;

  const [records, total] = await Promise.all([
    prisma.file.findMany({
      where,
      skip,
      take: USER_PAGE_SIZE,
      orderBy,
      select: {
        id:           true,
        originalName: true,
        fileType:     true,
        status:       true,
        totalPiiFound:true,
        uploadedAt:   true,
        processedAt:  true,
      },
    }),
    prisma.file.count({ where }),
  ]);

  return NextResponse.json({
    files:   records,
    total,
    hasMore: skip + USER_PAGE_SIZE < total,
    page,
  });
}
