import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helper";
import { getEncryptionStatus } from "@/lib/get-encryption-status";

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

  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.url.startsWith("https") ? "https" : "http");

  const status = await getEncryptionStatus(proto);
  return NextResponse.json(status);
}
