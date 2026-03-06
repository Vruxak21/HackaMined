#!/usr/bin/env node
/**
 * Encryption Setup Verification Script
 *
 * Checks that all required encryption environment variables are present
 * and correctly formatted before the application starts.
 *
 * Usage:
 *   npx tsx scripts/verify-encryption-setup.ts
 *   npx ts-node scripts/verify-encryption-setup.ts
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env from the project root (one directory up from scripts/)
config({ path: resolve(__dirname, "../.env") });

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";

type CheckResult = { label: string; pass: boolean; detail: string };

function pass(label: string, detail: string): CheckResult {
  return { label, pass: true, detail };
}

function fail(label: string, detail: string): CheckResult {
  return { label, pass: false, detail };
}

// ── Individual checks ─────────────────────────────────────────────────────────

function checkEncryptionKey(): CheckResult {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return fail("ENCRYPTION_KEY", "Variable is not set");
  if (!/^[0-9a-fA-F]+$/.test(key)) {
    return fail("ENCRYPTION_KEY", "Contains non-hex characters");
  }
  if (key.length !== 64) {
    return fail(
      "ENCRYPTION_KEY",
      `Must be exactly 64 hex chars (32 bytes). Got ${key.length} chars.`,
    );
  }
  return pass("ENCRYPTION_KEY", "64-char hex key found ✓");
}

function checkKeyVersion(): CheckResult {
  const version = process.env.ENCRYPTION_KEY_VERSION;
  if (!version) return fail("ENCRYPTION_KEY_VERSION", "Variable is not set");
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) {
    return fail("ENCRYPTION_KEY_VERSION", `Must be a positive integer. Got: "${version}"`);
  }
  return pass("ENCRYPTION_KEY_VERSION", `Version ${n} ✓`);
}

function checkInternalServiceSecret(): CheckResult {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return fail("INTERNAL_SERVICE_SECRET", "Variable is not set");
  if (secret.length < 32) {
    return fail(
      "INTERNAL_SERVICE_SECRET",
      `Too short — must be at least 32 characters. Got ${secret.length}.`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(secret)) {
    return fail("INTERNAL_SERVICE_SECRET", "Contains non-hex characters (should be hex)");
  }
  if (secret.length !== 64) {
    return fail(
      "INTERNAL_SERVICE_SECRET",
      `Should be exactly 64 hex chars (32 bytes). Got ${secret.length} chars.`,
    );
  }
  return pass("INTERNAL_SERVICE_SECRET", "64-char hex secret found ✓");
}

function checkDatabaseUrl(): CheckResult {
  const url = process.env.DATABASE_URL;
  if (!url) return fail("DATABASE_URL (sslmode)", "DATABASE_URL is not set");
  const hasssl =
    url.includes("sslmode=") ||
    url.includes("ssl=true") ||
    url.startsWith("prisma+postgres://"); // Prisma Postgres uses SSL by default
  if (!hasssl) {
    return fail(
      "DATABASE_URL (sslmode)",
      "No sslmode parameter found — add ?sslmode=require to DATABASE_URL",
    );
  }
  // Warn if sslmode is set to an insecure value
  const sslMatch = url.match(/sslmode=([^&]+)/);
  if (sslMatch) {
    const mode = sslMatch[1];
    if (mode === "disable") {
      return fail("DATABASE_URL (sslmode)", `sslmode=disable disables SSL entirely`);
    }
    return pass(
      "DATABASE_URL (sslmode)",
      `sslmode=${mode} detected ✓`,
    );
  }
  return pass("DATABASE_URL (sslmode)", "SSL parameter found ✓");
}

function checkNextPublicAppUrl(): CheckResult {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    return fail("NEXT_PUBLIC_APP_URL", "Variable is not set — set to https://localhost:3000 for dev");
  }
  if (!url.startsWith("https://")) {
    return fail("NEXT_PUBLIC_APP_URL", `URL should start with https:// — got: ${url}`);
  }
  return pass("NEXT_PUBLIC_APP_URL", `${url} ✓`);
}

// ── Runner ────────────────────────────────────────────────────────────────────

const checks: CheckResult[] = [
  checkEncryptionKey(),
  checkKeyVersion(),
  checkInternalServiceSecret(),
  checkDatabaseUrl(),
  checkNextPublicAppUrl(),
];

const allPassed = checks.every((c) => c.pass);
const passCount = checks.filter((c) => c.pass).length;
const failCount = checks.filter((c) => !c.pass).length;

console.log("");
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}${CYAN}   Encryption Setup Verification                  ${RESET}`);
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log("");

for (const check of checks) {
  const icon   = check.pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  const detail = check.pass
    ? `${DIM}${check.detail}${RESET}`
    : `${YELLOW}${check.detail}${RESET}`;

  console.log(`  [${icon}] ${BOLD}${check.label}${RESET}`);
  console.log(`        ${detail}`);
  console.log("");
}

console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);

if (allPassed) {
  console.log(`${BOLD}${GREEN}  Encryption setup: READY${RESET}  (${passCount}/${checks.length} checks passed)`);
} else {
  console.log(`${BOLD}${RED}  Encryption setup: INCOMPLETE${RESET}  (${failCount} check${failCount > 1 ? "s" : ""} failed)`);
  console.log("");
  console.log(`${YELLOW}  Run: npx tsx scripts/generate-keys.ts${RESET}`);
  console.log(`${YELLOW}  to generate missing keys and add them to .env${RESET}`);
}

console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log("");

// Exit with non-zero code if any checks failed (useful in CI)
if (!allPassed) process.exit(1);
