"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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

// ─────────────────────────────────────────────────────────────────────────────

type SanitizedFile = {
  id: string;
  originalName: string;
  fileType: string;
  piiRemoved: number;
  processedAt: string;
};

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

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
  const [files, setFiles] = useState<SanitizedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((data: { files: Array<{
        id: string; originalName: string; fileType: string;
        totalPiiFound: number; processedAt: string | null;
      }> }) => {
        setFiles(
          data.files.map((f) => ({
            id: f.id,
            originalName: f.originalName,
            fileType: f.fileType,
            piiRemoved: f.totalPiiFound,
            processedAt: f.processedAt ?? "",
          }))
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = useCallback(async (fileId: string, filename: string) => {
    const res = await fetch(`/api/files/${fileId}/download?type=sanitized`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const filtered = useMemo(
    () => files.filter((f) => f.originalName.toLowerCase().includes(query.toLowerCase())),
    [files, query]
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">My Sanitized Files</h1>
        {!loading && (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
            {files.length}
          </span>
        )}
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

      {/* File cards */}
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
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => handleDownload(file.id, file.originalName)}>
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
