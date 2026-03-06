/**
 * AES-256-GCM encryption utility for encrypting sensitive fields at rest.
 *
 * Format stored in the database:
 *   enc:<iv_base64>.<authtag_base64>.<ciphertext_base64>
 *
 * The "enc:" prefix uniquely identifies encrypted values so that backward-
 * compatible reads work correctly — any value lacking the prefix is returned
 * as plaintext (useful during the migration window before all records are
 * re-encrypted).
 *
 * Key source: ENCRYPTION_KEY env var (64 hex characters = 32 bytes)
 * Generate:   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;   // 96-bit IV — NIST recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag (GCM default)
const ENC_PREFIX = "enc:";

// ── Key loading ───────────────────────────────────────────────────────────────

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${key.length} bytes.`,
    );
  }
  return key;
}

// ── Core encrypt / decrypt ────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 plaintext string with AES-256-GCM.
 *
 * Returns a string in the form:
 *   enc:<iv_b64>.<tag_b64>.<ciphertext_b64>
 *
 * Each encryption uses a fresh random IV, so identical plaintexts produce
 * different ciphertexts ("probabilistic encryption").
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return (
    ENC_PREFIX +
    iv.toString("base64") +
    "." +
    tag.toString("base64") +
    "." +
    encrypted.toString("base64")
  );
}

/**
 * Decrypt a string produced by encrypt().
 *
 * Backward-compatible: if the value does NOT start with "enc:" it is returned
 * as-is, allowing plaintext records written before encryption was enabled to
 * continue to be readable without a full re-encryption migration.
 *
 * Throws if the payload is malformed or if GCM authentication fails.
 */
export function decrypt(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) {
    // Backward-compat: plaintext record written before encryption was enabled.
    return value;
  }

  const key = getKey();
  const payload = value.slice(ENC_PREFIX.length);
  const parts = payload.split(".");

  if (parts.length !== 3) {
    throw new Error(
      `Malformed encrypted value (expected 3 dot-separated parts, got ${parts.length})`,
    );
  }

  const [ivB64, tagB64, cipherB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(cipherB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ── Nullable helpers ──────────────────────────────────────────────────────────

/**
 * Encrypt a string that may be null or undefined.
 * Returns null for null / undefined input.
 */
export function encryptNullable(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  return encrypt(value);
}

/**
 * Decrypt a nullable string (null / undefined → null, plaintext → plaintext).
 */
export function decryptNullable(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  return decrypt(value);
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Returns true when the value was produced by encrypt().
 * Useful for tooling / migration scripts to identify already-encrypted records.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}
