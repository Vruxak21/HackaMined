import { AuditFilterTable, type AuditRow } from "@/components/admin/AuditFilterTable";

// ── MOCK DATA (replace with real Prisma query) ────────────────────────────────

const mockLogs: AuditRow[] = [
  { id: "a01", timestamp: new Date("2026-03-05T08:02:00"), userEmail: "admin@piisanitizer.com", action: "LOGIN",    fileName: undefined,                  detail: "Admin logged in",                ipAddress: "192.168.1.10" },
  { id: "a02", timestamp: new Date("2026-03-05T08:05:00"), userEmail: "admin@piisanitizer.com", action: "UPLOAD",   fileName: "salary_details_2025.csv",  detail: "Uploaded CSV file",              ipAddress: "192.168.1.10" },
  { id: "a03", timestamp: new Date("2026-03-05T08:05:30"), userEmail: "admin@piisanitizer.com", action: "SCAN",     fileName: "salary_details_2025.csv",  detail: "PII scan completed — 0 found",  ipAddress: "192.168.1.10" },
  { id: "a04", timestamp: new Date("2026-03-04T16:45:00"), userEmail: "admin@piisanitizer.com", action: "UPLOAD",   fileName: "id_scans_batch.png",       detail: "Uploaded PNG image",            ipAddress: "192.168.1.10" },
  { id: "a05", timestamp: new Date("2026-03-04T16:45:40"), userEmail: "admin@piisanitizer.com", action: "SCAN",     fileName: "id_scans_batch.png",       detail: "PII scan completed — 5 found",  ipAddress: "192.168.1.10" },
  { id: "a06", timestamp: new Date("2026-03-04T17:10:00"), userEmail: "user@piisanitizer.com",  action: "LOGIN",    fileName: undefined,                  detail: "User logged in",                ipAddress: "10.0.0.42" },
  { id: "a07", timestamp: new Date("2026-03-04T17:12:00"), userEmail: "user@piisanitizer.com",  action: "VIEW",     fileName: "id_scans_batch.png",       detail: "Viewed sanitized file",         ipAddress: "10.0.0.42" },
  { id: "a08", timestamp: new Date("2026-03-04T17:14:00"), userEmail: "user@piisanitizer.com",  action: "DOWNLOAD", fileName: "id_scans_batch.png",       detail: "Downloaded sanitized file",     ipAddress: "10.0.0.42" },
  { id: "a09", timestamp: new Date("2026-03-03T09:00:00"), userEmail: "admin@piisanitizer.com", action: "UPLOAD",   fileName: "patient_data.docx",        detail: "Uploaded DOCX file",            ipAddress: "192.168.1.10" },
  { id: "a10", timestamp: new Date("2026-03-03T09:01:00"), userEmail: "admin@piisanitizer.com", action: "LOGOUT",   fileName: undefined,                  detail: "Admin signed out",              ipAddress: "192.168.1.10" },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminAuditPage() {
  // TODO: replace mockLogs with Prisma query result
  const logs = mockLogs;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
          {logs.length} entries
        </span>
      </div>

      {/* Filter tabs + table (client island) */}
      <AuditFilterTable logs={logs} />
    </div>
  );
}
