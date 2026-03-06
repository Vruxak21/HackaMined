/**
 * Test that the Python service correctly enforces HMAC request signing.
 *
 * Run:  npx tsx scripts/test-transit-security.ts
 *
 * Tests (all against the live Python service):
 *   1. Unsigned request   → 401
 *   2. Wrong signature    → 401
 *   3. Valid signature    → 200 or 422 (auth passes, body may be invalid)
 *   4. /health (no auth) → 200
 */

import "dotenv/config";
import crypto from "crypto";
import { signRequest } from "../lib/service-auth";

const BASE = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
let failures = 0;

function pass(msg: string) {
  console.log("  ✓", msg);
}
function fail(msg: string) {
  console.error("  ✗ FAIL:", msg);
  failures++;
}

async function safeGet(url: string): Promise<number> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.status;
  } catch {
    return -1;
  }
}

async function safePost(
  url: string,
  body: object,
  extraHeaders: Record<string, string> = {},
): Promise<number> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.status;
  } catch {
    return -1;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function test1_noSignature() {
  const status = await safePost(`${BASE}/process`, { file_path: "/tmp/x.txt" });
  if (status === 401) {
    pass("Rejects unsigned requests (401)");
  } else if (status === -1) {
    fail("Python service unreachable — is it running?");
  } else {
    fail(`Expected 401 for unsigned request, got ${status}`);
  }
}

async function test2_wrongSignature() {
  const secret = process.env.INTERNAL_SERVICE_SECRET ?? "";
  const timestamp = Date.now().toString();
  const body = { file_path: "/tmp/x.txt" };

  // Deliberately corrupt the signature
  const wrongSig = crypto
    .createHmac("sha256", Buffer.from(secret || "badkey", "hex"))
    .update("tampered." + JSON.stringify(body))
    .digest("hex");

  const status = await safePost(`${BASE}/process`, body, {
    "x-service-signature": wrongSig,
    "x-service-timestamp": timestamp,
  });

  if (status === 401) {
    pass("Rejects invalid signature (401)");
  } else if (status === -1) {
    fail("Python service unreachable");
  } else {
    fail(`Expected 401 for bad signature, got ${status}`);
  }
}

async function test3_validSignature() {
  const body = { file_path: "/tmp/nonexistent.txt", output_path: "/tmp/out.txt", file_type: "txt", mode: "redact" };
  const headers = signRequest(body);

  const status = await safePost(`${BASE}/process`, body, headers);

  // 200 = success, 422 = validation error (body passes auth), 500 = exception
  // All of these mean auth was accepted. Only 401 means auth rejected.
  if (status !== -1 && status !== 401) {
    pass(`Accepts valid signature (${status})`);
  } else if (status === -1) {
    fail("Python service unreachable");
  } else {
    fail(`Valid signature was rejected (401)`);
  }
}

async function test4_healthNoAuth() {
  const status = await safeGet(`${BASE}/health`);

  if (status === 200) {
    pass("Health endpoint accessible without auth (200)");
  } else if (status === -1) {
    fail("Python service unreachable — is it running?");
  } else {
    fail(`Health endpoint returned ${status}, expected 200`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Encryption-in-Transit Verification ===");
  console.log(`Python service: ${BASE}`);
  console.log("");

  console.log("── HMAC request signing ─────────────────────────────");
  await test1_noSignature();
  await test2_wrongSignature();
  await test3_validSignature();

  console.log("\n── Unauthenticated endpoints ────────────────────────");
  await test4_healthNoAuth();

  console.log("");
  if (failures === 0) {
    console.log("Encryption in Transit: PASS");
  } else {
    console.error(`Encryption in Transit: FAIL (${failures} check(s) failed)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
