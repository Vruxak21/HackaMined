/**
 * Core AES-256-GCM encryption utility for sensitive fields stored at rest.
 *
 * Encrypted format (all parts are base64, joined by ":"):
 *   <iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 * Backward-compatible: any value that doesn't look like the encrypted format
 * (i.e. doesn't split into exactly 3 colon-separated parts) is returned as-is.
 * This allows gradual migration of pre-encryption records without downtime.
 *
 * Key source: ENCRYPTION_KEY env var (64 hex characters = 32 bytes)
 * Generate:   npx tsx scripts/generate-keys.ts
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;          // 128-bit IV
const AUTH_TAG_LENGTH = 16;    // 128-bit GCM auth tag

export const KEY_VERSION = process.env.ENCRYPTION_KEY_VERSION ?? "1";

// ── Private key loader ────────────────────────────────────────────────────────

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error("ENCRYPTION_KEY not configured");
  return Buffer.from(hex, "hex");
}

// ── Core encrypt / decrypt ────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * - null / undefined → null
 * - empty string     → empty string
 * - otherwise        → "<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 *
 * Each call uses a fresh random IV, so identical plaintexts produce
 * different ciphertexts (probabilistic encryption).
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  if (plaintext === "") return "";

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return (
    iv.toString("base64") +
    ":" +
    authTag.toString("base64") +
    ":" +
    encrypted.toString("base64")
  );
}

/**
 * Decrypt a string produced by encrypt().
 *
 * - null / undefined / empty → returned as-is (null)
 * - no ":" in value          → returned as-is (legacy plaintext)
 * - not exactly 3 parts      → returned as-is (not encrypted format)
 * - GCM tag mismatch / error → logs warning, returns "[DECRYPTION_FAILED]"
 *
 * Never throws — callers should handle "[DECRYPTION_FAILED]" if needed.
 */
export function decrypt(encrypted: string | null | undefined): string | null {
  if (encrypted == null) return null;
  if (encrypted === "") return "";

  // If there are no colons, it's not encrypted (legacy plaintext)
  if (!encrypted.includes(":")) return encrypted;

  const parts = encrypted.split(":");
  // Must be exactly 3 parts: iv:authTag:ciphertext
  if (parts.length !== 3) return encrypted;

  try {
    const [ivB64, authTagB64, cipherB64] = parts as [string, string, string];
    const iv       = Buffer.from(ivB64, "base64");
    const authTag  = Buffer.from(authTagB64, "base64");
    const cipherData = Buffer.from(cipherB64, "base64");

    // Validate lengths before attempting decryption. A mismatch means this
    // is not our ciphertext (e.g. legacy plaintext with colons in it).
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      return encrypted;
    }

    const key = getKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(cipherData),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    console.warn(
      "[encryption] Decryption failed:",
      err instanceof Error ? err.message : err,
    );
    return "[DECRYPTION_FAILED]";
  }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

/**
 * JSON.stringify an object then encrypt it.
 * null → null
 */
export function encryptJSON(obj: object | null | undefined): string | null {
  if (obj == null) return null;
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt a string and JSON.parse the result.
 * Returns {} on any failure (null input, decryption error, parse error).
 */
export function decryptJSON(encrypted: string | null | undefined): object {
  const result = decrypt(encrypted);
  if (result == null || result === "[DECRYPTION_FAILED]") return {};
  try {
    return JSON.parse(result) as object;
  } catch {
    return {};
  }
}

// ── Migration helper ──────────────────────────────────────────────────────────

/**
 * Returns true when a value looks like it was produced by encrypt().
 * Checks for the pattern: base64:base64:base64
 */
export function isEncrypted(value: string): boolean {
  const b64Segment = "[A-Za-z0-9+/]+=*";
  return new RegExp(`^${b64Segment}:${b64Segment}:${b64Segment}$`).test(value);
}

// ── Batch field helpers ───────────────────────────────────────────────────────

/**
 * Returns a shallow copy of `data` with only the named `fields` encrypted.
 * Fields that are null / undefined are left as null.
 */
export function encryptFields(
  data: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const result = { ...data };
  for (const field of fields) {
    if (field in result) {
      const val = result[field];
      result[field] = val != null ? encrypt(String(val)) : null;
    }
  }
  return result;
}

/**
 * Returns a shallow copy of `data` with only the named `fields` decrypted.
 * Fields that are null / undefined are left as null.
 */
export function decryptFields(
  data: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const result = { ...data };
  for (const field of fields) {
    if (field in result) {
      const val = result[field];
      result[field] = val != null ? decrypt(String(val)) : null;
    }
  }
  return result;
}

// ── Field-name constants ──────────────────────────────────────────────────────

export const ENCRYPTED_FILE_FIELDS = [
  "originalContent",
  "sanitizedContent",
  "piiSummary",
  "layerBreakdown",
  "confidenceBreakdown",
] as const;

export const ENCRYPTED_AUDIT_FIELDS = [
  "detail",
  "ipAddress",
] as const;
