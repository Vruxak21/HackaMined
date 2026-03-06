/**
 * HMAC-SHA256 signing utility for internal Next.js → Python service requests.
 *
 * Every POST to the Python service includes an "X-Service-Signature" header:
 *   X-Service-Signature: sha256=<hex_digest>
 *
 * The Python service verifies this signature before processing any request.
 * This prevents direct access to the Python service without going through
 * the Next.js API layer.
 *
 * Key source: INTERNAL_SERVICE_SECRET env var (any secure random string)
 * Generate:   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If INTERNAL_SERVICE_SECRET is not set, signing is disabled and an empty string
 * is returned — the Python service must also have the secret unset to accept
 * unsigned requests (useful for local dev without HMAC enforcement).
 */

import { createHmac } from "crypto";

/**
 * Compute an HMAC-SHA256 signature over a stringified request body.
 *
 * Returns "sha256=<lowercase_hex>" for use as the X-Service-Signature header,
 * or an empty string when INTERNAL_SERVICE_SECRET is not configured.
 */
export function signBody(body: string): string {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return "";
  return (
    "sha256=" +
    createHmac("sha256", secret).update(body, "utf8").digest("hex")
  );
}
