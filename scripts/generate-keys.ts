#!/usr/bin/env node
/**
 * Key Generation Script
 *
 * Generates cryptographically secure random keys for the PII Sanitization
 * platform's encryption infrastructure.
 *
 * Usage:
 *   npx tsx scripts/generate-keys.ts
 *   npx ts-node scripts/generate-keys.ts
 */

import { randomBytes } from "crypto";

function generateHexKey(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

const encryptionKey = generateHexKey(32);      // 32 bytes → 64 hex chars
const internalSecret = generateHexKey(32);     // 32 bytes → 64 hex chars

const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const CYAN  = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED   = "\x1b[31m";
const GREEN = "\x1b[32m";

console.log("");
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}${CYAN}   PII Sanitization Platform — Key Generator      ${RESET}`);
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log("");
console.log("Add these lines to your .env file:");
console.log("");
console.log(`${GREEN}# Encryption at Rest (AES-256-GCM)${RESET}`);
console.log(`ENCRYPTION_KEY=${encryptionKey}`);
console.log(`ENCRYPTION_KEY_VERSION=1`);
console.log("");
console.log(`${GREEN}# Encryption in Transit — Next.js to Python service (HMAC-SHA256)${RESET}`);
console.log(`INTERNAL_SERVICE_SECRET=${internalSecret}`);
console.log("");
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log("");
console.log(`${BOLD}${RED}⚠  WARNING${RESET}`);
console.log(`${YELLOW}Save these keys securely. Losing them means losing all encrypted data.${RESET}`);
console.log(`${YELLOW}• Never commit .env to source control.${RESET}`);
console.log(`${YELLOW}• Store a backup of ENCRYPTION_KEY in a password manager or secrets vault.${RESET}`);
console.log(`${YELLOW}• If you rotate ENCRYPTION_KEY, increment ENCRYPTION_KEY_VERSION${RESET}`);
console.log(`${YELLOW}  and re-encrypt existing records before discarding the old key.${RESET}`);
console.log("");
