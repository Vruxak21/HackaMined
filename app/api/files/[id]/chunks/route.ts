import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// ── GET /api/files/[id]/chunks ─────────────────────────────────────────────
//
// Returns per-chunk processing status for large (chunked) files.
//
// While the file is PROCESSING  → proxies to the Python service's live
//                                  /process-status/{id} endpoint.
// Once DONE or FAILED            → reads the persisted chunk_statuses from
//                                  processingInfo in the database (no Python call).

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
    select: { status: true, processingInfo: true },
  });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // ── Completed file: serve persisted chunk statuses from DB ─────────────
  if (file.status !== "PROCESSING") {
    const pi: {
      chunked_processing?: boolean;
      total_chunks?: number;
      completed_chunks?: number;
      failed_chunks?: number;
      chunk_statuses?: Record<string, string>;
    } | null = file.processingInfo ? JSON.parse(file.processingInfo) : null;

    if (!pi?.chunked_processing) {
      return NextResponse.json({
        progress: {},
        completed: 0,
        total: 0,
        percent: 100,
        chunked: false,
      });
    }

    const total = pi.total_chunks ?? 0;
    const completed = pi.completed_chunks ?? 0;
    const chunkStatuses = pi.chunk_statuses ?? {};

    return NextResponse.json({
      job_id: id,
      progress: chunkStatuses,
      completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 100,
      chunked: true,
    });
  }

  // ── File still processing: proxy to Python service (no HMAC needed for GET) ─
  const baseUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${baseUrl}/process-status/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });

    if (!res.ok) {
      // Python service unavailable or no active job — return empty state
      return NextResponse.json({
        job_id: id,
        progress: {},
        completed: 0,
        total: 0,
        percent: 0,
        chunked: true,
      });
    }

    const data = await res.json() as {
      job_id: string;
      progress: Record<string, string>;
      completed: number;
      total: number;
      percent: number;
      pipeline_config?: {
        use_bert: boolean;
        use_spacy: boolean;
        spacy_model: string;
        skip_bert_reason: string;
      };
    };

    const resp = NextResponse.json({ ...data, chunked: true });
    resp.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return resp;
  } catch {
    return NextResponse.json({
      job_id: id,
      progress: {},
      completed: 0,
      total: 0,
      percent: 0,
      chunked: true,
    });
  }
}
