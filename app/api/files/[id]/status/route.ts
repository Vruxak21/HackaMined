import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import prisma from "@/lib/db";
import { decryptJSON } from "@/lib/encryption";

export const dynamic = "force-dynamic";

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// ── GET /api/files/[id]/status — poll every 1500 ms ──────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth();
  } catch (err) {
    if (isRedirectError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const { id } = await params;

  const file = await prisma.file.findUnique({
    where: { id },
    select: {
      status: true,
      totalPiiFound: true,
      piiSummary: true,
      layerBreakdown: true,
      processedAt: true,
      processingInfo: true,
    },
  });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const resp = NextResponse.json({
    status: file.status,
    totalPiiFound: file.totalPiiFound,
    piiSummary: decryptJSON(file.piiSummary),
    layerBreakdown: decryptJSON(file.layerBreakdown),
    processedAt: file.processedAt,
    processingInfo: file.processingInfo ? JSON.parse(file.processingInfo) : null,
  });
  resp.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return resp;
}
