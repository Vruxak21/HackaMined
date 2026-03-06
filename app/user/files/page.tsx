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
  pdf: { icon: FileText, color: "text-red-500" },
  csv: { icon: FileSpreadsheet, color: "text-emerald-600" },
  json: { icon: FileJson, color: "text-amber-500" },
  docx: { icon: File, color: "text-blue-500" },
  sql: { icon: FileCode2, color: "text-violet-500" },
  txt: { icon: FileText, color: "text-muted-foreground" },
  png: { icon: Image, color: "text-pink-500" },
  jpg: { icon: Image, color: "text-pink-500" },
  jpeg: { icon: Image, color: "text-pink-500" },
};

function FileTypeIcon({ type }: { type: string }) {
  const entry = fileIconMap[type.toLowerCase()];
  if (!entry) return <File className="size-7 text-muted-foreground" />;
  const Icon = entry.icon;
  return <Icon className={cn("size-7", entry.color)} />;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex animate-pulse items-center gap-4 rounded-lg border border-border bg-card p-4">
      <div className="size-9 rounded-md bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-48 rounded bg-muted" />
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="h-2.5 w-24 rounded bg-muted/70" />
      </div>
      <div className="h-8 w-24 rounded-md bg-muted" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UserFilesPage() {
  const [files, setFiles] = useState<SanitizedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((data: {
        files: Array<{
          id: string; originalName: string; fileType: string;
          totalPiiFound: number; processedAt: string | null;
        }>
      }) => {
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
      .catch(() => { })
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-foreground tracking-tight">My Sanitized Files</h1>
        {!loading && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {files.length}
          </span>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search files by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-10 border-border/70 bg-card"
        />
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
          <ShieldCheck size={36} className="opacity-30" />
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              {query ? "No files match your search." : "No sanitized files found."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {!query && "Files will appear here once an admin processes them."}
            </p>
          </div>
        </div>
      )}

      {/* File cards */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {filtered.map((file) => (
            <div
              key={file.id}
              className="group flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm"
            >
              {/* Icon */}
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileTypeIcon type={file.fileType} />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {file.originalName}
                </p>
                <p className="mt-0.5 text-xs font-medium text-destructive">
                  {file.piiRemoved} PII instance{file.piiRemoved !== 1 ? "s" : ""} removed
                </p>
                <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                  Processed {formatDate(file.processedAt)}
                </p>
              </div>

              {/* Download */}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5 border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                onClick={() => handleDownload(file.id, file.originalName)}
              >
                <Download size={12} />
                Download
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
