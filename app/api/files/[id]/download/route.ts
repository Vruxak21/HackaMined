import { NextRequest, NextResponse } from "next/server";
import { requireAuth, logAction } from "@/lib/auth-helper";
import prisma from "@/lib/db";

const MIME_TYPES: Record<string, string> = {
  pdf:  "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc:  "application/msword",
  sql:  "text/plain",
  csv:  "text/csv",
  txt:  "text/plain",
  md:   "text/markdown",
  json: "application/json",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
};

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// ── GET /api/files/[id]/download?type=sanitized|original ─────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth();
  } catch (err) {
    if (isRedirectError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const { id } = await params;
  const type = req.nextUrl.searchParams.get("type") ?? "sanitized";

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.status !== "DONE") {
    return NextResponse.json({ error: "File not ready" }, { status: 400 });
  }

  // Users may only download the sanitized version
  if (type === "original" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const base64Content =
    type === "original" ? file.originalContent : file.sanitizedContent;

  if (!base64Content) {
    return NextResponse.json({ error: "Content not available" }, { status: 404 });
  }

  const buffer = Buffer.from(base64Content, "base64");
  const ext = file.fileType;
  const baseName = file.originalName.replace(/\.[^.]+$/, "");
  const suffix = type === "original" ? "original" : "sanitized";
  const downloadName = `${baseName}_${suffix}.${ext}`;
  const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";

  await logAction({
    userId: user.id,
    action: "DOWNLOAD",
    fileId: id,
    detail: `Downloaded ${type} version of ${file.originalName}`,
  });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
