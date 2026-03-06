import { NextResponse } from "next/server";
import { requireAuth, logAction } from "@/lib/auth-helper";
import prisma from "@/lib/db";
import { getFile } from "@/lib/db-encrypted";

const TEXT_TYPES = new Set(["sql", "csv", "txt", "json", "md"]);

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function decodeContent(
  base64: string | null,
  fileType: string,
): string {
  if (!base64) return "";
  if (TEXT_TYPES.has(fileType)) {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  return `[Binary ${fileType.toUpperCase()} file — download to view]`;
}

// ── GET /api/files/[id] ───────────────────────────────────────────────────

export async function GET(
  _req: Request,
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

  const file = await getFile(id);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  await logAction({ userId: user.id, action: "VIEW", fileId: id });

  if (user.role === "ADMIN") {
    const originalContent = decodeContent(
      file.originalContent as string | null,
      file.fileType as string,
    );
    const sanitizedContent = decodeContent(
      file.sanitizedContent as string | null,
      file.fileType as string,
    );

    return NextResponse.json({
      file: {
        id: file.id,
        originalName: file.originalName,
        fileType: file.fileType,
        status: file.status,
        maskingMode: file.maskingMode,
        totalPiiFound: file.totalPiiFound,
        uploadedBy: file.uploadedBy,
        uploadedAt: file.uploadedAt,
        processedAt: file.processedAt,
      },
      originalContent,
      sanitizedContent,
      piiSummary: file.piiSummary,
      layerBreakdown: file.layerBreakdown,
      confidenceBreakdown: file.confidenceBreakdown,
    });
  }

  // USER — minimal safe fields, no content
  return NextResponse.json({
    file: {
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      status: file.status,
      totalPiiFound: file.totalPiiFound,
      processedAt: file.processedAt,
    },
    originalContent: "",
    sanitizedContent: "",
    piiSummary: {},
    layerBreakdown: {},
    confidenceBreakdown: {},
  });
}

// ── DELETE /api/files/[id] ────────────────────────────────────────────────

export async function DELETE(
  _req: Request,
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

  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const file = await prisma.file.findUnique({ where: { id }, select: { id: true } });
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  await prisma.file.delete({ where: { id } });
  await logAction({ userId: user.id, action: "DELETE", fileId: id });

  return NextResponse.json({ success: true });
}
