"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  X,
  SlidersHorizontal,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type SanitizedFile = {
  id: string;
  originalName: string;
  fileType: string;
  piiRemoved: number;
  uploadedAt: string;
  processedAt: string;
};

type ApiFile = {
  id: string;
  originalName: string;
  fileType: string;
  totalPiiFound: number;
  uploadedAt: string;
  processedAt: string | null;
};

type ApiResponse = {
  files: ApiFile[];
  total: number;
  hasMore: boolean;
  page: number;
};

// â”€â”€ Filter / Sort config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type DateRange = "all" | "7d" | "30d" | "3m" | "1y";
type PiiRange  = "any" | "none" | "low" | "medium" | "high";
type SortKey   = "newest" | "oldest" | "pii-desc" | "pii-asc" | "name-az" | "name-za";

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all:   "All time",
  "7d":  "Last 7 days",
  "30d": "Last 30 days",
  "3m":  "Last 3 months",
  "1y":  "Last year",
};

const PII_LABELS: Record<PiiRange, string> = {
  any:    "Any PII count",
  none:   "No PII (0)",
  low:    "Low (1â€“10)",
  medium: "Medium (11â€“50)",
  high:   "High (51+)",
};

const SORT_LABELS: Record<SortKey, string> = {
  newest:     "Newest first",
  oldest:     "Oldest first",
  "pii-desc": "Most PII first",
  "pii-asc":  "Least PII first",
  "name-az":  "Name A â†’ Z",
  "name-za":  "Name Z â†’ A",
};

const FILE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all",   label: "All types" },
  { value: "pdf",   label: "PDF" },
  { value: "csv",   label: "CSV" },
  { value: "json",  label: "JSON" },
  { value: "docx",  label: "DOCX" },
  { value: "sql",   label: "SQL" },
  { value: "txt",   label: "TXT" },
  { value: "image", label: "Images (PNG / JPG)" },
];

// â”€â”€ File icon map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const fileIconMap: Record<string, { icon: React.ElementType; color: string }> = {
  pdf:  { icon: FileText,        color: "text-red-500" },
  csv:  { icon: FileSpreadsheet, color: "text-emerald-600" },
  json: { icon: FileJson,        color: "text-amber-500" },
  docx: { icon: File,            color: "text-blue-500" },
  sql:  { icon: FileCode2,       color: "text-violet-500" },
  txt:  { icon: FileText,        color: "text-muted-foreground" },
  png:  { icon: Image,           color: "text-pink-500" },
  jpg:  { icon: Image,           color: "text-pink-500" },
  jpeg: { icon: Image,           color: "text-pink-500" },
};

function FileTypeIcon({ type }: { type: string }) {
  const entry = fileIconMap[type.toLowerCase()];
  if (!entry) return <File className="size-7 text-muted-foreground" />;
  const Icon = entry.icon;
  return <Icon className={cn("size-7", entry.color)} />;
}

function formatDate(d: string) {
  if (!d) return "â€”";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function mapFile(f: ApiFile): SanitizedFile {
  return {
    id:           f.id,
    originalName: f.originalName,
    fileType:     f.fileType,
    piiRemoved:   f.totalPiiFound,
    uploadedAt:   f.uploadedAt   ?? "",
    processedAt:  f.processedAt  ?? "",
  };
}

// â”€â”€ Skeleton card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Active filter badge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FilterBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 text-[0.7rem] font-medium px-2 py-0.5">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded hover:text-destructive"
        aria-label={`Remove ${label} filter`}
      >
        <X className="size-2.5" />
      </button>
    </Badge>
  );
}

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function UserFilesPage() {
  const [files,          setFiles]          = useState<SanitizedFile[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [hasMore,        setHasMore]        = useState(false);
  const [total,          setTotal]          = useState(0);

  // â”€â”€ Filter / sort state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [query,     setQuery]     = useState("");
  const [debQuery,  setDebQuery]  = useState("");
  const [fileType,  setFileType]  = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [piiRange,  setPiiRange]  = useState<PiiRange>("any");
  const [sort,      setSort]      = useState<SortKey>("newest");

  // Refs â€” avoid stale closures in IntersectionObserver
  const fetchingRef  = useRef(false);
  const pageRef      = useRef(1);
  const sentinelRef  = useRef<HTMLDivElement>(null);

  // â”€â”€ Debounce query (300 ms) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const t = setTimeout(() => setDebQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // â”€â”€ Build URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const buildUrl = useCallback(
    (pageNum: number) => {
      const params = new URLSearchParams({ page: String(pageNum) });
      if (debQuery)         params.set("q",         debQuery);
      if (fileType  !== "all") params.set("fileType",  fileType);
      if (dateRange !== "all") params.set("dateRange", dateRange);
      if (piiRange  !== "any") params.set("piiRange",  piiRange);
      if (sort !== "newest")   params.set("sort",       sort);
      return `/api/files?${params}`;
    },
    [debQuery, fileType, dateRange, piiRange, sort],
  );

  // â”€â”€ Reset + fetch page 1 whenever filters change â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    pageRef.current   = 1;
    fetchingRef.current = true;
    setFiles([]);
    setHasMore(false);
    setInitialLoading(true);

    fetch(buildUrl(1))
      .then((r) => r.json())
      .then((data: ApiResponse) => {
        setFiles((data.files ?? []).map(mapFile));
        setTotal(data.total   ?? 0);
        setHasMore(data.hasMore ?? false);
      })
      .catch(() => {})
      .finally(() => {
        setInitialLoading(false);
        fetchingRef.current = false;
      });
  }, [buildUrl]);

  // â”€â”€ Load next page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadMore = useCallback(() => {
    if (fetchingRef.current || !hasMore) return;
    const next = pageRef.current + 1;
    pageRef.current  = next;
    fetchingRef.current = true;
    setLoadingMore(true);

    fetch(buildUrl(next))
      .then((r) => r.json())
      .then((data: ApiResponse) => {
        setFiles((prev) => [...prev, ...(data.files ?? []).map(mapFile)]);
        setTotal(data.total   ?? 0);
        setHasMore(data.hasMore ?? false);
      })
      .catch(() => {})
      .finally(() => {
        setLoadingMore(false);
        fetchingRef.current = false;
      });
  }, [hasMore, buildUrl]);

  // â”€â”€ IntersectionObserver on sentinel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Recreated whenever loadMore changes (filters or hasMore updated).
  // IntersectionObserver fires immediately for already-visible elements,
  // so if < 10 results all fit on screen we still try to load next page.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // â”€â”€ Download â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleDownload = useCallback(async (fileId: string, filename: string) => {
    const res = await fetch(`/api/files/${fileId}/download?type=sanitized`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }, []);

  // â”€â”€ Active filter chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (fileType !== "all") {
    const opt = FILE_TYPE_OPTIONS.find((o) => o.value === fileType);
    activeFilters.push({ key: "type", label: `Type: ${opt?.label ?? fileType}`, clear: () => setFileType("all") });
  }
  if (dateRange !== "all") {
    activeFilters.push({ key: "date", label: `Date: ${DATE_RANGE_LABELS[dateRange]}`, clear: () => setDateRange("all") });
  }
  if (piiRange !== "any") {
    activeFilters.push({ key: "pii", label: `PII: ${PII_LABELS[piiRange]}`, clear: () => setPiiRange("any") });
  }

  const hasActiveFilters = !!(query || activeFilters.length);

  function clearAll() {
    setQuery(""); setFileType("all"); setDateRange("all"); setPiiRange("any");
  }

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-foreground tracking-tight">My Sanitized Files</h1>
        {!initialLoading && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {total}
          </span>
        )}
      </div>

      {/* Search + Filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex flex-col gap-3">

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search files by nameâ€¦"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-9 h-10 border-border/70 bg-card"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
            <SlidersHorizontal className="size-3.5" />
            Filters:
          </span>

          {/* File type */}
          <Select value={fileType} onValueChange={setFileType}>
            <SelectTrigger className="h-8 w-auto min-w-27.5 text-xs border-border/70 bg-card">
              <SelectValue placeholder="File type" />
            </SelectTrigger>
            <SelectContent>
              {FILE_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range */}
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="h-8 w-auto min-w-32.5 text-xs border-border/70 bg-card">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {DATE_RANGE_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* PII count */}
          <Select value={piiRange} onValueChange={(v) => setPiiRange(v as PiiRange)}>
            <SelectTrigger className="h-8 w-auto min-w-35 text-xs border-border/70 bg-card">
              <SelectValue placeholder="PII count" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PII_LABELS) as PiiRange[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {PII_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Separator orientation="vertical" className="h-5 hidden sm:block" />

          {/* Sort */}
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-auto min-w-37 text-xs border-border/70 bg-card">
              <ArrowUpDown className="size-3 mr-1.5 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeFilters.map((f) => (
              <FilterBadge key={f.key} label={f.label} onRemove={f.clear} />
            ))}
            <button
              type="button"
              onClick={clearAll}
              className="ml-1 text-[0.7rem] text-muted-foreground hover:text-destructive underline underline-offset-2"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Result count */}
        {!initialLoading && (
          <p className="text-[0.7rem] text-muted-foreground">
            {hasActiveFilters
              ? `${total} file${total !== 1 ? "s" : ""} match your filters`
              : `${total} file${total !== 1 ? "s" : ""} total`}
          </p>
        )}
      </div>

      {/* Initial skeleton */}
      {initialLoading && (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!initialLoading && files.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
          <ShieldCheck size={36} className="opacity-30" />
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              {hasActiveFilters ? "No files match your filters." : "No sanitized files found."}
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearAll}
                className="mt-1 text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Files will appear here once they have been processed.
              </p>
            )}
          </div>
        </div>
      )}

      {/* File cards */}
      {!initialLoading && files.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {files.map((file) => (
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

      {/* Load-more skeleton â€” shown while fetching next page */}
      {loadingMore && (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Sentinel â€” IntersectionObserver watches this element */}
      <div ref={sentinelRef} className="h-1" aria-hidden />

      {/* End of list indicator */}
      {!initialLoading && !hasMore && files.length > 0 && (
        <p className="text-center text-[0.7rem] text-muted-foreground pb-2">
          All {total} file{total !== 1 ? "s" : ""} loaded
        </p>
      )}
    </div>
  );
}
