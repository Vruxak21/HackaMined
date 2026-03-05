"use client";

import { useState, useMemo } from "react";
import {
  Search,
  Download,
  ShieldCheck,
  FileText,
  FileSpreadsheet,
  FileJson,
  FileCode2,
  Image,
  File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── MOCK DATA (replace with real API call for authenticated user) ──────────────

type SanitizedFile = {
  id: string;
  originalName: string;
  fileType: string;
  piiRemoved: number;
  processedAt: Date;
};

const mockFiles: SanitizedFile[] = [
  { id: "f1", originalName: "customers_q1_2026.csv",  fileType: "csv",  piiRemoved: 23, processedAt: new Date("2026-03-01T09:16:00") },
  { id: "f2", originalName: "employee_records.pdf",   fileType: "pdf",  piiRemoved: 41, processedAt: new Date("2026-03-02T11:31:00") },
  { id: "f3", originalName: "transactions_feb.sql",   fileType: "sql",  piiRemoved: 7,  processedAt: new Date("2026-03-02T14:11:00") },
  { id: "f5", originalName: "user_export.json",       fileType: "json", piiRemoved: 12, processedAt: new Date("2026-03-03T16:21:00") },
  { id: "f7", originalName: "id_scans_batch.png",     fileType: "png",  piiRemoved: 5,  processedAt: new Date("2026-03-04T13:51:00") },
];

// ─────────────────────────────────────────────────────────────────────────────

const fileIconMap: Record<string, { icon: React.ElementType; color: string }> = {
  pdf:  { icon: FileText,        color: "text-red-500" },
  csv:  { icon: FileSpreadsheet, color: "text-green-600" },
  json: { icon: FileJson,        color: "text-yellow-500" },
  docx: { icon: File,            color: "text-blue-500" },
  sql:  { icon: FileCode2,       color: "text-purple-500" },
  txt:  { icon: FileText,        color: "text-gray-400" },
  png:  { icon: Image,           color: "text-pink-500" },
  jpg:  { icon: Image,           color: "text-pink-500" },
  jpeg: { icon: Image,           color: "text-pink-500" },
};

function FileTypeIcon({ type }: { type: string }) {
  const entry = fileIconMap[type.toLowerCase()];
  if (!entry) return <File className="size-8 text-gray-400" />;
  const Icon = entry.icon;
  return <Icon className={cn("size-8", entry.color)} />;
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Skeleton card ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex animate-pulse items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="size-10 rounded-lg bg-gray-200" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-48 rounded bg-gray-200" />
        <div className="h-3 w-32 rounded bg-gray-100" />
        <div className="h-3 w-24 rounded bg-gray-100" />
      </div>
      <div className="h-8 w-24 rounded-md bg-gray-200" />
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function UserFilesPage() {
  // TODO: replace with real data loaded from API (user's sanitized files only)
  const [loading] = useState(false); // set to true to preview skeleton state
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      mockFiles.filter((f) =>
        f.originalName.toLowerCase().includes(query.toLowerCase())
      ),
    [query]
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">My Sanitized Files</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
          {mockFiles.length}
        </span>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400 pointer-events-none" />
        <Input
          placeholder="Search files by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-gray-400">
          <ShieldCheck size={42} className="opacity-40" />
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-500">
              {query ? "No files match your search." : "No sanitized files found."}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {!query && "Files will appear here once an admin processes them."}
            </p>
          </div>
        </div>
      )}

      {/* File cards (MOCK: replace with real sanitized file data) */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-col gap-3">
          {filtered.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Icon */}
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gray-50">
                <FileTypeIcon type={file.fileType} />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-800">
                  {file.originalName}
                </p>
                <p className="mt-0.5 text-xs font-medium text-red-500">
                  {file.piiRemoved} PII instance{file.piiRemoved !== 1 ? "s" : ""} removed
                </p>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  Processed {formatDate(file.processedAt)}
                </p>
              </div>

              {/* Download */}
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5">
                <Download size={13} />
                Download
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
