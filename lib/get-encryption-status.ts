/**
 * Shared helper used by both the /api/admin/encryption-status route handler
 * and the admin dashboard server component to probe encryption health without
 * requiring an internal HTTP round-trip (and therefore without losing the
 * auth cookie context).
 */

import prisma from "./db";
import { isEncrypted, ENCRYPTED_FILE_FIELDS, KEY_VERSION } from "./encryption";

export interface EncryptionStatus {
  encryptionAtRest: {
    status: "active" | "partial" | "no_data";
    algorithm: string;
    keyVersion: number;
    fieldsEncrypted: string[];
    fieldsFailed: string[];
    sampleChecked: boolean;
  };
  encryptionInTransit: {
    browserToServer: string;
    serverToPython: string;
    serverToDatabase: string;
  };
}

async function probePythonService(): Promise<"reachable" | "unreachable"> {
  try {
    const url =
      (process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000") + "/health";
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function probeFileEncryption(): Promise<{
  sampleChecked: boolean;
  fieldsEncrypted: string[];
  fieldsFailed: string[];
}> {
  type RawFile = Record<string, string | null>;

  let rows: RawFile[] = [];
  try {
    rows = await prisma.$queryRaw<RawFile[]>`
      SELECT "originalContent", "sanitizedContent",
             "piiSummary", "layerBreakdown", "confidenceBreakdown"
      FROM   "File"
      WHERE  "originalContent" IS NOT NULL
      LIMIT  1
    `;
  } catch {
    return { sampleChecked: false, fieldsEncrypted: [], fieldsFailed: [] };
  }

  if (rows.length === 0) {
    return { sampleChecked: false, fieldsEncrypted: [], fieldsFailed: [] };
  }

  const row = rows[0];
  const fieldsEncrypted: string[] = [];
  const fieldsFailed: string[] = [];

  for (const field of ENCRYPTED_FILE_FIELDS) {
    const val = row[field];
    if (val == null || val === "") continue;
    if (isEncrypted(val)) {
      fieldsEncrypted.push(field);
    } else {
      fieldsFailed.push(field);
    }
  }

  return { sampleChecked: true, fieldsEncrypted, fieldsFailed };
}

/**
 * Probe DB + Python service + env vars and return the encryption status
 * object used by both the API route and the dashboard server component.
 *
 * @param protocol  "https" | "http" — detected from request headers by the caller.
 */
export async function getEncryptionStatus(
  protocol: string,
): Promise<EncryptionStatus> {
  const [pythonStatus, fileProbe] = await Promise.all([
    probePythonService(),
    probeFileEncryption(),
  ]);

  const browserToServer =
    protocol === "https" ? "HTTPS" : "HTTP (not encrypted)";

  const dbUrl = process.env.DATABASE_URL ?? "";
  const serverToDatabase =
    dbUrl.includes("sslmode=verify-full") ? "SSL (verify-full)" :
    dbUrl.includes("sslmode=require")     ? "SSL (require)"     :
    dbUrl.includes("sslmode=prefer")      ? "SSL (prefer)"      :
    "unencrypted";

  const atRestStatus =
    !fileProbe.sampleChecked
      ? "no_data"
      : fileProbe.fieldsFailed.length === 0
        ? "active"
        : "partial";

  return {
    encryptionAtRest: {
      status: atRestStatus,
      algorithm: "AES-256-GCM",
      keyVersion: parseInt(KEY_VERSION, 10),
      fieldsEncrypted: fileProbe.fieldsEncrypted,
      fieldsFailed: fileProbe.fieldsFailed,
      sampleChecked: fileProbe.sampleChecked,
    },
    encryptionInTransit: {
      browserToServer,
      serverToPython:
        process.env.INTERNAL_SERVICE_SECRET
          ? `HMAC-SHA256 signed (python service ${pythonStatus})`
          : `unsigned — INTERNAL_SERVICE_SECRET not set (python service ${pythonStatus})`,
      serverToDatabase,
    },
  };
}
