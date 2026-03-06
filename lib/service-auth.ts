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

const SIGNATURE_HEADER = "x-service-signature";
const TIMESTAMP_HEADER = "x-service-timestamp";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_AGE_SECONDS = 30; // enforced on the Python side; documented here for clarity

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

/**
 * Send an HMAC-signed POST request to the internal Python service.
 *
 * @param endpoint - Path relative to PYTHON_SERVICE_URL (e.g. "/process")
 * @param body     - JSON-serialisable request payload
 * @returns        The raw fetch Response (caller checks res.ok / res.json())
 * @throws Error("Python service timeout") when the 120 s deadline is exceeded
 */
export async function callPythonService(
  endpoint: string,
  body: object,
): Promise<Response> {
  const baseUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  const url = baseUrl + endpoint;
  const headers = signRequest(body);

  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("Python service timeout");
    }
    throw err;
  }
}
