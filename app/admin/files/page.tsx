import { Suspense } from "react";
import { FilesSearchTable, type FileRow } from "@/components/admin/FilesSearchTable";

// ── MOCK DATA (replace with real Prisma query) ────────────────────────────────

const mockFiles: FileRow[] = [
  { id: "f1", originalName: "customers_q1_2026.csv",   fileType: "csv",  status: "DONE",       totalPiiFound: 23, maskingMode: "redact",   uploadedAt: new Date("2026-03-01T09:15:00"), uploadedBy: "admin@piisanitizer.com" },
  { id: "f2", originalName: "employee_records.pdf",    fileType: "pdf",  status: "DONE",       totalPiiFound: 41, maskingMode: "mask",     uploadedAt: new Date("2026-03-02T11:30:00"), uploadedBy: "admin@piisanitizer.com" },
  { id: "f3", originalName: "transactions_feb.sql",    fileType: "sql",  status: "DONE",       totalPiiFound: 7,  maskingMode: "tokenize", uploadedAt: new Date("2026-03-02T14:10:00"), uploadedBy: "admin@piisanitizer.com" },
  { id: "f4", originalName: "patient_data.docx",       fileType: "docx", status: "PROCESSING", totalPiiFound: 0,  maskingMode: "redact",   uploadedAt: new Date("2026-03-03T08:45:00"), uploadedBy: "admin@piisanitizer.com" },
  { id: "f5", originalName: "user_export.json",        fileType: "json", status: "DONE",       totalPiiFound: 12, maskingMode: "redact",   uploadedAt: new Date("2026-03-03T16:20:00"), uploadedBy: "admin@piisanitizer.com" },
  { id: "f6", originalName: "vendors_list.txt",        fileType: "txt",  status: "FAILED",     totalPiiFound: 0,  maskingMode: "mask",     uploadedAt: new Date("2026-03-04T10:05:00"), uploadedBy: "admin@piisanitizer.com" },
  { id: "f7", originalName: "id_scans_batch.png",      fileType: "png",  status: "DONE",       totalPiiFound: 5,  maskingMode: "redact",   uploadedAt: new Date("2026-03-04T13:50:00"), uploadedBy: "admin@piisanitizer.com" },
  { id: "f8", originalName: "salary_details_2025.csv", fileType: "csv",  status: "DONE",       totalPiiFound: 0,  maskingMode: "tokenize", uploadedAt: new Date("2026-03-05T07:30:00"), uploadedBy: "admin@piisanitizer.com" },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminFilesPage() {
  // TODO: replace mockFiles with Prisma query result
  const files = mockFiles;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">All Files</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
          {files.length}
        </span>
      </div>

      {/* Search + Table (client island) */}
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
            Loading files…
          </div>
        }
      >
        <FilesSearchTable files={files} />
      </Suspense>
    </div>
  );
}
