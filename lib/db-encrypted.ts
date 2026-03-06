/**
 * Encrypted Prisma helpers for File and AuditLog models.
 *
 * All functions in this module automatically encrypt sensitive fields before
 * writing to the database and decrypt them after reading. Call-sites should
 * use these helpers instead of calling prisma directly for models that contain
 * sensitive data.
 *
 * Encrypted File fields:   originalContent, sanitizedContent, piiSummary,
 *                          layerBreakdown, confidenceBreakdown
 * Encrypted AuditLog fields: detail, ipAddress
 */

import prisma from "./db";
import {
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  KEY_VERSION,
} from "./encryption";
import type { Action } from "./generated/prisma/client";

// ── Input / output types ──────────────────────────────────────────────────────

export interface CreateFileInput {
  originalName: string;
  fileType: string;
  originalContent: string; // base64
  maskingMode: string;
  uploadedBy: string;
}

export interface ProcessingResult {
  sanitizedContent: string; // base64
  piiSummary: object;
  totalPiiFound: number;
  layerBreakdown: object;
  confidenceBreakdown: object;
  processedAt: Date;
}

export interface AuditLogInput {
  userId: string;
  action: Action;
  fileId?: string;
  detail?: string;
  ipAddress?: string;
}

// ── Private decrypt helper ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decryptFile(file: Record<string, any>): Record<string, any> {
  return {
    ...file,
    originalContent:
      file.originalContent != null ? decrypt(file.originalContent) : null,
    sanitizedContent:
      file.sanitizedContent != null ? decrypt(file.sanitizedContent) : null,
    piiSummary:
      file.piiSummary != null ? decryptJSON(file.piiSummary) : null,
    layerBreakdown:
      file.layerBreakdown != null ? decryptJSON(file.layerBreakdown) : null,
    confidenceBreakdown:
      file.confidenceBreakdown != null
        ? decryptJSON(file.confidenceBreakdown)
        : null,
  };
}

// ── File operations ───────────────────────────────────────────────────────────

/**
 * Create a new File record with originalContent encrypted at rest.
 */
export async function createFile(data: CreateFileInput) {
  const record = await prisma.file.create({
    data: {
      originalName: data.originalName,
      fileType: data.fileType,
      status: "PROCESSING",
      originalContent: encrypt(data.originalContent),
      maskingMode: data.maskingMode,
      uploadedBy: data.uploadedBy,
      encryptionKeyVersion: parseInt(KEY_VERSION, 10),
    },
  });
  return decryptFile(record);
}

/**
 * Persist PII scan results for a File, encrypting all sensitive output fields.
 */
export async function updateFileAfterProcessing(
  fileId: string,
  data: ProcessingResult,
) {
  const record = await prisma.file.update({
    where: { id: fileId },
    data: {
      status: "DONE",
      sanitizedContent: encrypt(data.sanitizedContent),
      piiSummary: encryptJSON(data.piiSummary),
      totalPiiFound: data.totalPiiFound,
      layerBreakdown: encryptJSON(data.layerBreakdown),
      confidenceBreakdown: encryptJSON(data.confidenceBreakdown),
      processedAt: data.processedAt,
      encryptionKeyVersion: parseInt(KEY_VERSION, 10),
    },
  });
  return decryptFile(record);
}

/**
 * Fetch a single File by id with all sensitive fields decrypted.
 * Returns null when the record does not exist.
 */
export async function getFile(fileId: string) {
  const record = await prisma.file.findUnique({ where: { id: fileId } });
  if (!record) return null;
  return decryptFile(record);
}

/**
 * Fetch a list of Files with an optional Prisma `where` clause.
 *
 * originalContent and sanitizedContent are intentionally excluded — they are
 * large blobs unsuitable for list views. Use getFileForDownload() when the
 * raw bytes are needed.
 */
export async function getFileList(where?: object) {
  const records = await prisma.file.findMany({
    where,
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      originalName: true,
      fileType: true,
      status: true,
      maskingMode: true,
      piiSummary: true,
      totalPiiFound: true,
      layerBreakdown: true,
      confidenceBreakdown: true,
      uploadedBy: true,
      uploadedAt: true,
      processedAt: true,
      encryptionKeyVersion: true,
      uploader: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  return records.map((f) => ({
    ...f,
    piiSummary: f.piiSummary != null ? decryptJSON(f.piiSummary) : null,
    layerBreakdown:
      f.layerBreakdown != null ? decryptJSON(f.layerBreakdown) : null,
    confidenceBreakdown:
      f.confidenceBreakdown != null
        ? decryptJSON(f.confidenceBreakdown)
        : null,
  }));
}

/**
 * Fetch, decrypt and return a single content field as a ready-to-serve Buffer.
 *
 * Returns null when the record does not exist or the content field is empty.
 */
export async function getFileForDownload(
  fileId: string,
  type: "original" | "sanitized",
): Promise<Buffer | null> {
  const select =
    type === "original"
      ? { originalContent: true }
      : { sanitizedContent: true };

  const record = await prisma.file.findUnique({
    where: { id: fileId },
    select,
  });

  if (!record) return null;

  const encryptedB64 =
    type === "original"
      ? (record as { originalContent: string | null }).originalContent
      : (record as { sanitizedContent: string | null }).sanitizedContent;

  if (!encryptedB64) return null;

  const decryptedB64 = decrypt(encryptedB64);
  if (!decryptedB64 || decryptedB64 === "[DECRYPTION_FAILED]") return null;

  return Buffer.from(decryptedB64, "base64");
}

// ── Audit log operations ──────────────────────────────────────────────────────

/**
 * Persist an audit log entry with detail and ipAddress encrypted at rest.
 *
 * Never throws — audit logging must not crash the main operation.
 */
export async function createAuditLog(data: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        fileId: data.fileId ?? null,
        detail: data.detail != null ? encrypt(data.detail) : null,
        ipAddress: data.ipAddress != null ? encrypt(data.ipAddress) : null,
        encryptionKeyVersion: parseInt(KEY_VERSION, 10),
      },
    });
  } catch (err) {
    console.error("[createAuditLog] Failed to write audit log:", err);
  }
}

/**
 * Fetch paginated audit logs with sensitive fields decrypted.
 * Includes the related user email and file name for display.
 */
export async function getAuditLogs(params: { page: number; limit: number }) {
  const { page, limit } = params;
  const skip = (page - 1) * limit;

  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      orderBy: { timestamp: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { email: true, name: true } },
        file: { select: { originalName: true } },
      },
    }),
    prisma.auditLog.count(),
  ]);

  const decrypted = logs.map((l) => ({
    ...l,
    detail: decrypt(l.detail),
    ipAddress: decrypt(l.ipAddress),
  }));

  return { logs: decrypted, total };
}
