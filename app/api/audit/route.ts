import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helper";
import { getAuditLogs } from "@/lib/db-encrypted";

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    if (isRedirectError(err)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  try {
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? 50)));

    const { logs, total } = await getAuditLogs({ page, limit });

    const safeLog = logs.map(({ encryptionKeyVersion: _, ...l }: Record<string, unknown>) => l);

    return NextResponse.json({ logs: safeLog, total, page, limit });
  } catch (err) {
    console.error("[GET /api/audit]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
