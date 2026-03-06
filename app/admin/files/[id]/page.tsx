"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Lock,
  Download,
  ShieldAlert,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  Layers,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────────────

type FileDetail = {
  id: string;
  originalName: string;
  fileType: string;
  status: "PROCESSING" | "DONE" | "FAILED";
  totalPiiFound: number;
  maskingMode: "redact" | "mask" | "tokenize";
  uploadedAt: string;
  processedAt: string | null;
};

type FileDetailData = {
  file: FileDetail;
  originalContent: string;
  sanitizedContent: string;
  piiSummary: Record<string, number>;
  layerBreakdown: { regex: number; spacy: number; bert: number; presidio_spacy?: number; indic_bert?: number };
  confidenceBreakdown: { high_confidence?: number; high?: number; medium_confidence?: number; medium?: number };
  processingInfo?: {
    file_size_mb: number;
    total_chunks: number;
    completed_chunks: number;
    failed_chunks: number;
    chunked_processing: boolean;
    chunk_statuses?: Record<string, string>;
    pipeline_config?: {
      use_bert: boolean;
      use_spacy: boolean;
      spacy_model: string;
      skip_bert_reason: string;
    };
    processing_time_seconds?: number;
  } | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const maskingModeStyle = {
  redact:   { bg: "bg-red-100",    text: "text-red-700",    label: "Redact" },
  mask:     { bg: "bg-yellow-100", text: "text-yellow-700", label: "Mask" },
  tokenize: { bg: "bg-blue-100",   text: "text-blue-700",   label: "Tokenize" },
} as const;

function piiTypeStyle(type: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    PERSON:         { bg: "bg-red-100",     text: "text-red-700" },
    NAME:           { bg: "bg-red-100",     text: "text-red-700" },
    AADHAAR:        { bg: "bg-orange-100",  text: "text-orange-700" },
    PAN:            { bg: "bg-yellow-100",  text: "text-yellow-700" },
    EMAIL_ADDRESS:  { bg: "bg-blue-100",    text: "text-blue-700" },
    IN_PHONE:       { bg: "bg-purple-100",  text: "text-purple-700" },
    PHONE_NUMBER:   { bg: "bg-purple-100",  text: "text-purple-700" },
    LOCATION:       { bg: "bg-pink-100",    text: "text-pink-700" },
    ADDRESS:        { bg: "bg-pink-100",    text: "text-pink-700" },
    CREDIT_CARD:    { bg: "bg-rose-100",    text: "text-rose-700" },
    IP_ADDRESS:     { bg: "bg-cyan-100",    text: "text-cyan-700" },
    UPI:            { bg: "bg-emerald-100", text: "text-emerald-700" },
    DATE_TIME:      { bg: "bg-indigo-100",  text: "text-indigo-700" },
    DATE_OF_BIRTH:  { bg: "bg-indigo-100",  text: "text-indigo-700" },
    IFSC:           { bg: "bg-teal-100",    text: "text-teal-700" },
    PASSPORT:       { bg: "bg-violet-100",  text: "text-violet-700" },
  };
  return map[type] ?? { bg: "bg-gray-100", text: "text-gray-700" };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white/70 hover:bg-white/20 hover:text-white transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodePanel({
  title,
  content,
  variant,
}: {
  title: React.ReactNode;
  content: string;
  variant: "original" | "sanitized";
}) {
  const isBinary = content.startsWith("[Binary");
  const headerCls = variant === "original" ? "bg-red-600" : "bg-green-600";
  const bodyBg    = variant === "original" ? "bg-red-50"  : "bg-green-50";

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 shadow-sm">
      <div className={cn("flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-white", headerCls)}>
        <span>{title}</span>
        <CopyButton text={content} />
      </div>
      <div className={cn("flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed max-h-125", bodyBg)}>
        {isBinary ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-500">
            <Download size={32} className="opacity-40" />
            <p className="text-sm">Binary file — use the download button above to retrieve it.</p>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap wrap-break-word">{content}</pre>
        )}
      </div>
    </div>
  );
}

function ProcessingBanner({ onRefresh }: { onRefresh: () => void }) {
  useEffect(() => {
    const id = setInterval(onRefresh, 2000);
    return () => clearInterval(id);
  }, [onRefresh]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
      <Loader2 size={16} className="shrink-0 animate-spin text-yellow-600" />
      <span>
        <span className="font-semibold">File is being processed…</span>{" "}
        Page will update automatically.
      </span>
    </div>
  );
}

// ── Chunk Status Panel ────────────────────────────────────────────────────────

type ChunkProgressData = {
  job_id?: string;
  progress: Record<string, string>;
  completed: number;
  total: number;
  percent: number;
  chunked: boolean;
};

const CHUNK_STATUS_CONFIG = {
  pending:    { label: "Pending",    icon: Clock,         bar: 0,   barClass: "bg-gray-300",  cardClass: "border-gray-200 bg-gray-50",   textClass: "text-gray-500" },
  processing: { label: "Processing", icon: RefreshCw,     bar: 50,  barClass: "bg-blue-400",  cardClass: "border-blue-200 bg-blue-50",   textClass: "text-blue-600" },
  done:       { label: "Done",       icon: CheckCircle2,  bar: 100, barClass: "bg-green-500", cardClass: "border-green-200 bg-green-50", textClass: "text-green-700" },
  failed:     { label: "Failed",     icon: XCircle,       bar: 100, barClass: "bg-red-400",   cardClass: "border-red-200 bg-red-50",     textClass: "text-red-600"  },
} as const;

type KnownStatus = keyof typeof CHUNK_STATUS_CONFIG;
function isKnownStatus(s: string): s is KnownStatus {
  return s in CHUNK_STATUS_CONFIG;
}

function ChunkCard({ index, total, status }: { index: number; total: number; status: string }) {
  const key = isKnownStatus(status) ? status : "pending";
  const cfg = CHUNK_STATUS_CONFIG[key];
  const Icon = cfg.icon;

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-300", cfg.cardClass)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">
          Chunk {index + 1}
          <span className="ml-1 font-normal text-gray-400">/ {total}</span>
        </span>
        <span className={cn("flex items-center gap-1 text-xs font-semibold", cfg.textClass)}>
          <Icon
            size={12}
            className={cn(key === "processing" && "animate-spin")}
          />
          {cfg.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        {key === "processing" ? (
          <div className="h-full animate-pulse rounded-full bg-blue-400 opacity-80" style={{ width: "60%" }} />
        ) : (
          <div
            className={cn("h-full rounded-full transition-all duration-500", cfg.barClass)}
            style={{ width: `${cfg.bar}%` }}
          />
        )}
      </div>
    </div>
  );
}

function ChunkStatusPanel({
  fileId,
  isProcessing,
  processingInfo,
}: {
  fileId: string;
  isProcessing: boolean;
  processingInfo?: {
    total_chunks: number;
    completed_chunks: number;
    failed_chunks: number;
    chunked_processing: boolean;
    chunk_statuses?: Record<string, string>;
  } | null;
}) {
  const [liveData, setLiveData] = useState<ChunkProgressData | null>(null);
  const [pollStarted, setPollStarted] = useState(false);

  // Poll Python live data only while the file is PROCESSING
  useEffect(() => {
    if (!isProcessing) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/files/${fileId}/chunks`);
        if (!cancelled && res.ok) {
          const data = await res.json() as ChunkProgressData;
          setLiveData(data);
          setPollStarted(true);
        }
      } catch {
        // network hiccup — keep showing previous data
      }
    };

    void poll();
    const timer = setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fileId, isProcessing]);

  // ── Determine display data ───────────────────────────────────────────────
  let displayProgress: Record<string, string> = {};
  let totalChunks = 0;
  let completedChunks = 0;
  let failedChunks = 0;

  if (isProcessing && liveData) {
    // If the chunks endpoint says it's NOT a chunked file, hide the panel
    if (!liveData.chunked) return null;
    displayProgress = liveData.progress;
    totalChunks = liveData.total;
    completedChunks = liveData.completed;
    failedChunks = Object.values(liveData.progress).filter(s => s === "failed").length;
  } else if (!isProcessing && processingInfo?.chunk_statuses) {
    displayProgress = processingInfo.chunk_statuses;
    totalChunks = processingInfo.total_chunks;
    completedChunks = processingInfo.completed_chunks;
    failedChunks = processingInfo.failed_chunks;
  } else if (!isProcessing && processingInfo?.chunked_processing) {
    // Fallback: no per-chunk statuses stored — synthesise from aggregate counts
    totalChunks = processingInfo.total_chunks;
    completedChunks = processingInfo.completed_chunks;
    failedChunks = processingInfo.failed_chunks;
    for (let i = 0; i < totalChunks; i++) {
      displayProgress[String(i)] = i < completedChunks ? "done" : "failed";
    }
  } else if (!isProcessing) {
    // Completed small file — no chunk panel needed
    return null;
  }

  const overallPct = totalChunks > 0
    ? Math.round((completedChunks / totalChunks) * 100)
    : 0;

  // ── Preparing state: processing but chunks not allocated yet ────────────
  if (isProcessing && totalChunks === 0) {
    // Haven't polled yet — don't flash the panel
    if (!pollStarted) return null;
    return (
      <Card className="border-purple-200 bg-purple-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-purple-800">
            <Layers size={16} className="text-purple-600" />
            Chunk Processing Status
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-purple-600">
            <Loader2 size={12} className="animate-spin" />
            Splitting file into chunks, please wait…
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 animate-pulse">
                <div className="h-3 w-16 rounded bg-gray-200" />
                <div className="h-1.5 w-full rounded-full bg-gray-200" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-purple-200 bg-purple-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-purple-800">
          <Layers size={16} className="text-purple-600" />
          Chunk Processing Status
        </CardTitle>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-purple-600">
            <span className="font-semibold">{completedChunks}</span> of{" "}
            <span className="font-semibold">{totalChunks}</span> chunks completed
            {failedChunks > 0 && (
              <span className="ml-2 font-semibold text-red-600">
                · {failedChunks} failed
              </span>
            )}
          </p>
          <span className="shrink-0 text-xs font-semibold text-purple-700">{overallPct}%</span>
        </div>
        {/* Overall progress bar */}
        <Progress
          value={overallPct}
          className="h-1.5 bg-purple-100 [&>div]:bg-purple-500"
        />
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: totalChunks }, (_, i) => {
            const status = displayProgress[String(i)] ?? (isProcessing ? "pending" : "done");
            return (
              <ChunkCard key={i} index={i} total={totalChunks} status={status} />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <div className={cn("flex flex-1 flex-col items-center rounded-lg border px-4 py-3 text-center", colorClass)}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="mt-0.5 text-xs font-medium leading-tight">{label}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminFileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<FileDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/files/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFetchError((err as { error?: string }).error ?? "Failed to load file.");
        return;
      }
      const json = await res.json();
      setData(json);
      setFetchError("");
    } catch {
      setFetchError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = useCallback(() => { fetchData(); }, [fetchData]);

  const handleDownload = useCallback(async (type: "original" | "sanitized") => {
    const res = await fetch(`/api/files/${id}/download?type=${type}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] ?? `file-${type}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20 text-gray-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }

  if (fetchError || !data) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 m-6 p-4 text-sm text-red-700">
        <AlertTriangle size={16} />
        {fetchError || "File not found."}
      </div>
    );
  }

  const { file, piiSummary, originalContent, sanitizedContent, layerBreakdown, confidenceBreakdown, processingInfo } = data;
  const modeStyle = maskingModeStyle[file.maskingMode];
  const highCount = confidenceBreakdown?.high_confidence ?? confidenceBreakdown?.high ?? 0;
  const mediumCount = confidenceBreakdown?.medium_confidence ?? confidenceBreakdown?.medium ?? 0;

  // Determine detection mode from pipeline_config
  const pipelineCfg = processingInfo?.pipeline_config;
  let detectionModeLabel = "Full AI (Regex + spaCy + BERT)";
  let detectionModeTooltip = "Used for files under 5MB for maximum accuracy";
  if (pipelineCfg) {
    if (pipelineCfg.use_bert) {
      detectionModeLabel = "Full AI (Regex + spaCy + BERT)";
      detectionModeTooltip = "Used for files under 5MB for maximum accuracy";
    } else if (pipelineCfg.use_spacy) {
      detectionModeLabel = "Fast (Regex + spaCy)";
      detectionModeTooltip = "BERT skipped for large files to maintain speed";
    } else {
      detectionModeLabel = "Structured (Regex only)";
      detectionModeTooltip = "CSV/SQL/JSON use regex only — no NLP needed";
    }
  }

  // spaCy count: new 'spacy' key or legacy 'presidio_spacy' key
  const spacyCount = layerBreakdown?.spacy ?? layerBreakdown?.presidio_spacy ?? 0;
  // BERT count: new 'bert' key or legacy 'indic_bert' key
  const bertCount = layerBreakdown?.bert ?? layerBreakdown?.indic_bert ?? 0;

  const unstructuredTypes = new Set(["txt", "pdf", "docx"]);
  const showBertSkipBanner = pipelineCfg && !pipelineCfg.use_bert && unstructuredTypes.has(file.fileType.toLowerCase());

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* ── 1. Top bar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Left: back + title + badges */}
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/files"
            className="flex w-fit items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to All Files
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{file.originalName}</h1>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {file.fileType}
            </span>
            <span className={cn("rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide", modeStyle.bg, modeStyle.text)}>
              {modeStyle.label}
            </span>
          </div>

          <p className="text-xs text-gray-400">
            Uploaded {formatDate(file.uploadedAt)}
            {file.processedAt && <> &middot; Processed {formatDate(file.processedAt)}</>}
          </p>
        </div>

        {/* Right: download buttons */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={file.status !== "DONE"}
            onClick={() => handleDownload("original")}
          >
            <Lock size={14} />
            Download Original
          </Button>
          <Button
            size="sm"
            className="gap-2"
            disabled={file.status !== "DONE"}
            onClick={() => handleDownload("sanitized")}
          >
            <Download size={14} />
            Download Sanitized
          </Button>
        </div>
      </div>

      {/* ── 2. Processing banner ─────────────────────────────────────────────── */}
      {file.status === "PROCESSING" && (
        <ProcessingBanner onRefresh={handleRefresh} />
      )}

      {/* ── 2b. Chunk Status Panel ───────────────────────────────────────────── */}
      {(file.status === "PROCESSING" || processingInfo?.chunked_processing) && (
        <ChunkStatusPanel
          fileId={file.id}
          isProcessing={file.status === "PROCESSING"}
          processingInfo={processingInfo}
        />
      )}

      {/* ── 2c. Processing Info ────────────────────────────────────────────── */}
      {file.status === "DONE" && processingInfo && (
        <Card className="border-gray-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-800">Processing Info</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
              {processingInfo.file_size_mb != null && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">File Size</span>
                    <span className="font-semibold text-gray-700">{processingInfo.file_size_mb.toFixed(1)} MB</span>
                  </div>
                  <div className="h-px bg-gray-100" />
                </>
              )}
              {processingInfo.chunked_processing && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Chunks Processed</span>
                    <span className="font-semibold text-gray-700">
                      {processingInfo.completed_chunks} of {processingInfo.total_chunks}
                    </span>
                  </div>
                  <div className="h-px bg-gray-100" />
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-600 flex items-center gap-1.5">
                  Detection Mode
                  <span className="group relative">
                    <Info size={12} className="text-gray-400 cursor-help" />
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 -translate-x-1/2 mb-1.5 w-52 rounded bg-gray-800 px-2.5 py-1.5 text-[0.65rem] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {detectionModeTooltip}
                    </span>
                  </span>
                </span>
                <span className="font-semibold text-gray-700">{detectionModeLabel}</span>
              </div>
              {processingInfo.processing_time_seconds != null && (
                <>
                  <div className="h-px bg-gray-100" />
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Processing Time</span>
                    <span className="font-semibold text-gray-700">
                      {processingInfo.processing_time_seconds < 60
                        ? `${Math.round(processingInfo.processing_time_seconds)} seconds`
                        : `${(processingInfo.processing_time_seconds / 60).toFixed(1)} minutes`}
                    </span>
                  </div>
                </>
              )}
            </div>
            {showBertSkipBanner && (
              <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
                <Info size={14} className="mt-0.5 shrink-0 text-blue-500" />
                <span>
                  <strong>BERT was skipped for this file.</strong>{" "}
                  Regex and spaCy detected all PII types except rare Indian names in free-form prose.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 3. PII Detection Summary ──────────────────────────────────────────── */}
      {file.totalPiiFound > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-red-800">
              <ShieldAlert size={18} className="text-red-600" />
              {file.totalPiiFound} PII Instances Detected and Masked
            </CardTitle>
            <p className="text-[13px] text-red-600/80">
              Masking mode applied:{" "}
              <span className="font-semibold capitalize">{file.maskingMode}</span>
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-5">
            {/* Detection Layer Breakdown */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                Detection Layer Breakdown
              </p>
              <div className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Regex Engine</span>
                  <span className="font-semibold text-gray-700">{layerBreakdown?.regex ?? 0} detected</span>
                </div>
                <div className="h-px bg-gray-100" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">spaCy NER</span>
                  <span className="font-semibold text-blue-700">{spacyCount} detected</span>
                </div>
                <div className="h-px bg-gray-100" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">BERT NER</span>
                  <span className="font-semibold text-purple-700">{bertCount} detected</span>
                </div>
              </div>
            </div>

            {/* Confidence Breakdown */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                Confidence Breakdown
              </p>
              <div className="flex gap-3">
                <StatBox label="High Confidence (85%+)"     value={highCount}   colorClass="border-green-200 bg-green-100 text-green-700" />
                <StatBox label="Medium Confidence (60–84%)" value={mediumCount} colorClass="border-yellow-200 bg-yellow-100 text-yellow-700" />
              </div>
            </div>

            {/* PII Type Badges */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                PII Types Found
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(piiSummary).map(([type, count]) => {
                  const { bg, text } = piiTypeStyle(type);
                  return (
                    <span
                      key={type}
                      className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", bg, text)}
                    >
                      {type.replace(/_/g, " ")}: {count}
                    </span>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 4. Side-by-Side Viewer ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CodePanel
          variant="original"
          title={
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={13} />
              Original — Admin Eyes Only
            </span>
          }
          content={originalContent}
        />
        <CodePanel
          variant="sanitized"
          title={
            <span className="flex items-center gap-1.5">
              <Check size={13} />
              Sanitized Output
            </span>
          }
          content={sanitizedContent}
        />
      </div>

    </div>
  );
}
