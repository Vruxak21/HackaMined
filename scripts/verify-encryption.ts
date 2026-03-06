/**
 * Verify that sensitive DB fields are actually encrypted at rest.
 *
 * Run:  npx tsx scripts/verify-encryption.ts
 *
 * Reads raw column values with $queryRaw (bypasses Prisma type layer)
 * to confirm the ciphertext format is present, then verifies decryption.
 */

import "dotenv/config";
import prisma from "../lib/db";
import {
  decrypt,
  isEncrypted,
  ENCRYPTED_FILE_FIELDS,
  ENCRYPTED_AUDIT_FIELDS,
} from "../lib/encryption";

let failures = 0;

function pass(msg: string) {
  console.log("  ✓", msg);
}
function fail(msg: string) {
  console.error("  ✗ FAIL:", msg);
  failures++;
}

// ── File fields ───────────────────────────────────────────────────────────────

async function checkFileEncryption() {
  console.log("\n── File encryption ──────────────────────────────────");

  type RawFile = {
    id: string;
    originalContent: string | null;
    sanitizedContent: string | null;
    piiSummary: string | null;
    layerBreakdown: string | null;
    confidenceBreakdown: string | null;
  };

  const rows = await prisma.$queryRaw<RawFile[]>`
    SELECT id,
           "originalContent",
           "sanitizedContent",
           "piiSummary",
           "layerBreakdown",
           "confidenceBreakdown"
    FROM   "File"
    LIMIT  1
  `;

  if (rows.length === 0) {
    console.log("  (no File records found — upload a file first)");
    return;
  }

  const row = rows[0];

  for (const field of ENCRYPTED_FILE_FIELDS) {
    const raw = row[field as keyof RawFile] as string | null;

    if (raw == null || raw === "") {
      console.log(`  ~ ${field}: null/empty — skipped`);
      continue;
    }

    if (isEncrypted(raw)) {
      pass(`${field} is encrypted in DB`);
    } else {
      fail(`${field} is NOT encrypted (raw value exposed)`);
      continue;
    }

    // Verify decryption round-trips
    const decrypted = decrypt(raw);
    if (decrypted === null || decrypted === "[DECRYPTION_FAILED]") {
      fail(`${field} decryption failed`);
    } else {
      pass(`${field} decrypts successfully`);
    }
  }
}

// ── AuditLog fields ───────────────────────────────────────────────────────────

async function checkAuditLogEncryption() {
  console.log("\n── AuditLog encryption ──────────────────────────────");

  type RawLog = {
    id: string;
    detail: string | null;
    ipAddress: string | null;
  };

  const rows = await prisma.$queryRaw<RawLog[]>`
    SELECT id, detail, "ipAddress"
    FROM   "audit_log"
    LIMIT  1
  `;

  if (rows.length === 0) {
    console.log("  (no AuditLog records found)");
    return;
  }

  const row = rows[0];

  for (const field of ENCRYPTED_AUDIT_FIELDS) {
    const raw = row[field as keyof RawLog] as string | null;

    if (raw == null || raw === "") {
      console.log(`  ~ ${field}: null/empty — skipped`);
      continue;
    }

    if (isEncrypted(raw)) {
      pass(`${field} is encrypted in DB`);
    } else {
      fail(`${field} is NOT encrypted (raw value exposed)`);
      continue;
    }

    const decrypted = decrypt(raw);
    if (decrypted === null || decrypted === "[DECRYPTION_FAILED]") {
      fail(`${field} decryption failed`);
    } else {
      pass(`${field} decrypts successfully`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Encryption-at-Rest Verification ===");
  console.log("Algorithm : AES-256-GCM");
  console.log("Key version:", process.env.ENCRYPTION_KEY_VERSION ?? "1");

  try {
    await checkFileEncryption();
    await checkAuditLogEncryption();
  } finally {
    await prisma.$disconnect();
  }

  console.log("");
  if (failures === 0) {
    console.log("Encryption at Rest: PASS");
  } else {
    console.error(`Encryption at Rest: FAIL (${failures} check(s) failed)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
