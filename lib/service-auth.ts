/**
 * Authenticated client for internal Next.js → Python service requests.
 *
 * Every POST is signed with HMAC-SHA256 over `<timestamp>.<body>` using
 * INTERNAL_SERVICE_SECRET (64 hex chars / 32 bytes decoded).  The Python
 * service verifies both the signature and the timestamp freshness before
 * processing any request.
 *
 * Key source: INTERNAL_SERVICE_SECRET env var (same value in both .env files).
 * Generate:   npx tsx scripts/generate-keys.ts
 */

import crypto from "crypto";
import { PYTHON_REQUEST_TIMEOUT_MS } from "./constants";

const SIGNATURE_HEADER = "x-service-signature";
const TIMESTAMP_HEADER = "x-service-timestamp";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_AGE_SECONDS = 30; // enforced on the Python side; documented here for clarity

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PythonServiceHealth {
  status: "ok" | "loading";
  models: {
    presidio: boolean;
    spacy_fast: boolean;
    spacy_full: boolean;
    errors: string[];
  };
}

export interface PipelineConfig {
  use_bert: boolean;
  use_spacy: boolean;
  spacy_model: string;
  skip_bert_reason: string;
}

export interface JobStatus {
  job_id: string;
  status: "pending" | "processing" | "done" | "failed";
  progress: number;
  chunks_total: number;
  chunks_done: number;
  chunks_failed: number;
  pipeline_config?: PipelineConfig;
  result?: Record<string, unknown>;
  error?: string;
}

// ── HMAC Signing ──────────────────────────────────────────────────────────────

/**
 * Build HMAC-signed headers for a Python service request.
 *
 * The signature is computed over `<timestamp_ms>.<JSON.stringify(body)>` so
 * that replayed requests (same body, different timestamp) are rejected.
 *
 * Returns a headers object ready to pass directly to fetch().
 */
export function signRequest(body: object): Record<string, string> {
  const secret = process.env.INTERNAL_SERVICE_SECRET ?? "";
  const timestamp = Date.now().toString();
  const payload = timestamp + "." + JSON.stringify(body);
  const key = Buffer.from(secret, "hex");
  const signature = crypto
    .createHmac("sha256", key)
    .update(payload)
    .digest("hex");

  return {
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: timestamp,
    "Content-Type": "application/json",
  };
}

// ── Python Service Client ─────────────────────────────────────────────────────

/**
 * Send an HMAC-signed POST request to the internal Python service.
 *
 * @param endpoint  - Path relative to PYTHON_SERVICE_URL (e.g. "/process")
 * @param body      - JSON-serialisable request payload
 * @param timeoutMs - Abort deadline in milliseconds (default from PYTHON_REQUEST_TIMEOUT_MS)
 * @returns         The raw fetch Response (caller checks res.ok / res.json())
 * @throws Error("Python service timeout") when the deadline is exceeded
 */
export async function callPythonService(
  endpoint: string,
  body: object,
  timeoutMs: number = PYTHON_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const baseUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  const url = baseUrl + endpoint;
  const headers = signRequest(body);

  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("Python service timeout");
    }
    throw err;
  }
}

/**
 * Fetch the Python service health status (unsigned GET).
 */
export async function checkHealth(timeoutMs = 5_000): Promise<PythonServiceHealth> {
  const baseUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  const res = await fetch(`${baseUrl}/health`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return res.json() as Promise<PythonServiceHealth>;
}

/**
 * Poll a background job's status (unsigned GET).
 */
export async function pollJobStatus(
  jobId: string,
  timeoutMs = 10_000,
): Promise<JobStatus> {
  const baseUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  const res = await fetch(
    `${baseUrl}/process-status/${encodeURIComponent(jobId)}`,
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  if (!res.ok) throw new Error(`Job status failed: HTTP ${res.status}`);
  return res.json() as Promise<JobStatus>;
}
