import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helper";
import prisma from "@/lib/db";
import { decryptJSON } from "@/lib/encryption";

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    if (isRedirectError(err)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  const files = await prisma.file.findMany({
    where: { status: "DONE" },
    select: {
      id: true,
      originalName: true,
      totalPiiFound: true,
      piiSummary: true,
      layerBreakdown: true,
    },
  });

  const piiAggregate: Record<string, number> = {};
  const layerAggregate: Record<string, number> = {};
  const piiPerFile: Array<{ name: string; total: number }> = [];

  for (const file of files) {
    if (file.totalPiiFound > 0) {
      piiPerFile.push({ name: file.originalName, total: file.totalPiiFound });
    }

    if (file.piiSummary) {
      const summary = decryptJSON(file.piiSummary) as Record<string, unknown>;
      for (const [type, count] of Object.entries(summary)) {
        if (typeof count === "number") {
          piiAggregate[type] = (piiAggregate[type] ?? 0) + count;
        }
      }
    }

    if (file.layerBreakdown) {
      const breakdown = decryptJSON(file.layerBreakdown) as Record<string, unknown>;
      for (const [layer, count] of Object.entries(breakdown)) {
        if (typeof count === "number") {
          layerAggregate[layer] = (layerAggregate[layer] ?? 0) + count;
        }
      }
    }
  }

  const piiDistribution = Object.entries(piiAggregate)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const layerBreakdown = Object.entries(layerAggregate)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Limit per-file chart to top 12 to avoid visual clutter
  piiPerFile.sort((a, b) => b.total - a.total);
  const topFiles = piiPerFile.slice(0, 12);

  return NextResponse.json({ piiDistribution, layerBreakdown, piiPerFile: topFiles });
}
