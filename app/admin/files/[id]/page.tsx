"use client";

import { useState, useEffect, useCallback } from "react";
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

// ── MOCK DATA (replace with real API calls keyed by params.id) ────────────────

const mockFile = {
  id: "mock-id",
  originalName: "demo_customers.csv",
  fileType: "csv",
  status: "DONE" as "PROCESSING" | "DONE" | "FAILED",
  totalPiiFound: 17,
  maskingMode: "redact" as "redact" | "mask" | "tokenize",
  uploadedAt: new Date(),
  processedAt: new Date(),
};

const mockPiiSummary: Record<string, number> = {
  PERSON: 3,
  EMAIL_ADDRESS: 3,
  IN_PHONE: 3,
  AADHAAR: 3,
  PAN: 3,
  UPI: 2,
};

// MOCK: detection layer breakdown from detection metadata
const mockLayerBreakdown = { regex: 8, presidio: 6, indicBert: 3 };

// MOCK: confidence distribution from confidence scoring engine
const mockConfidenceBreakdown = { high: 12, medium: 5 };

const mockOriginal =
  "id,name,email,phone,aadhaar\n1,Rahul Sharma,rahul@gmail.com,9876543210,5487 8795 5678";

const mockSanitized =
  "id,name,email,phone,aadhaar\n1,[REDACTED],[REDACTED],[REDACTED],[REDACTED]";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date) {
  return d.toLocaleString("en-IN", {
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
  params: { id: string };
}) {
  // TODO: fetch real file by params.id from API
  const file = mockFile;
  const piiSummary = mockPiiSummary;
  const originalContent = mockOriginal;
  const sanitizedContent = mockSanitized;

  // TODO: replace with router.refresh() or SWR revalidation on real data
  const handleRefresh = useCallback(() => {}, []);

  const modeStyle = maskingModeStyle[file.maskingMode];

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
          <Button variant="outline" size="sm" className="gap-2">
            <Lock size={14} />
            Download Original
          </Button>
          <Button size="sm" className="gap-2">
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
              <div className="flex gap-3">
                {/* MOCK: counts sourced from detection engine metadata */}
                <StatBox label="Regex Engine"    value={mockLayerBreakdown.regex}      colorClass="border-gray-200 bg-gray-100 text-gray-700" />
                <StatBox label="Presidio + spaCy" value={mockLayerBreakdown.presidio}  colorClass="border-blue-200 bg-blue-100 text-blue-700" />
                <StatBox label="indic-bert"        value={mockLayerBreakdown.indicBert} colorClass="border-purple-200 bg-purple-100 text-purple-700" />
              </div>
            </div>

            {/* Confidence Breakdown */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                Confidence Breakdown
              </p>
              <div className="flex gap-3">
                {/* MOCK: sourced from confidence scoring engine (tiered thresholds) */}
                <StatBox label="High Confidence (85%+)"      value={mockConfidenceBreakdown.high}   colorClass="border-green-200 bg-green-100 text-green-700" />
                <StatBox label="Medium Confidence (60–84%)"  value={mockConfidenceBreakdown.medium} colorClass="border-yellow-200 bg-yellow-100 text-yellow-700" />
              </div>
            </div>

            {/* PII Type Badges */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                PII Types Found
              </p>
              <div className="flex flex-wrap gap-2">
                {/* MOCK: piiSummary keyed by entity type from detection engine */}
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
        {/* MOCK: originalContent decoded from base64 DB column */}
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
        {/* MOCK: sanitizedContent from sanitized DB column */}
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
