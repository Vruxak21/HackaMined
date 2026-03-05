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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  layerBreakdown: { regex: number; presidio_spacy: number; indic_bert: number };
  confidenceBreakdown: { high_confidence?: number; high?: number; medium_confidence?: number; medium?: number };
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

  const { file, piiSummary, originalContent, sanitizedContent, layerBreakdown, confidenceBreakdown } = data;
  const modeStyle = maskingModeStyle[file.maskingMode];
  const highCount = confidenceBreakdown?.high_confidence ?? confidenceBreakdown?.high ?? 0;
  const mediumCount = confidenceBreakdown?.medium_confidence ?? confidenceBreakdown?.medium ?? 0;

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
                  <span className="text-gray-600">Presidio + spaCy</span>
                  <span className="font-semibold text-blue-700">{layerBreakdown?.presidio_spacy ?? 0} detected</span>
                </div>
                <div className="h-px bg-gray-100" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">indic-bert</span>
                  <span className="font-semibold text-purple-700">{layerBreakdown?.indic_bert ?? 0} detected</span>
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
