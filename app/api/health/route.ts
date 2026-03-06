import { NextResponse } from "next/server";

/**
 * GET /api/health
 * Proxies the Python service health check so the frontend never needs to
 * talk directly to :8000.
 *
 * Python response shape (new pipeline):
 * {
 *   status: "ok" | "loading",
 *   models: { presidio, spacy_fast, spacy_full, errors },
 *   service: string,
 *   model_loaded: boolean,
 *   ...
 * }
 *
 * We pass through the entire response and add `available: true/false`.
 */
export async function GET() {
  const pythonUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

  try {
    const res = await fetch(`${pythonUrl}/health`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          available: false,
          status: "loading",
          model_loaded: false,
          models: { presidio: false, spacy_fast: false, spacy_full: false, errors: [] },
        },
        { status: 200 },
      );
    }

    const data = await res.json();
    return NextResponse.json({ available: true, ...data });
  } catch {
    return NextResponse.json(
      {
        available: false,
        status: "loading",
        model_loaded: false,
        models: { presidio: false, spacy_fast: false, spacy_full: false, errors: [] },
      },
      { status: 200 },
    );
  }
}
