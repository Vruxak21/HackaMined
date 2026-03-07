import React, { useState, useCallback } from "react";
import {
  X,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getEntityColors, getLayerLabel, getConfidenceColor } from "@/lib/diff/entityColors";
import {
  Mail, Phone, Fingerprint, CreditCard, User, MapPin, Wallet,
  ShieldAlert, Globe, Calendar,
} from "lucide-react";
import type { EntityType, PiiEntity } from "@/lib/diff/diffTypes";

interface EntityDetailPanelProps {
  entity: PiiEntity;
  lineNumber: number;
  occurrenceIndex: number;
  totalOccurrences: number;
  onClose: () => void;
  onPrevOccurrence: () => void;
  onNextOccurrence: () => void;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently fail
    }
  }, [value]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={handleCopy}
      className={cn(
        "p-1 rounded transition-all duration-100",
        "text-gray-400 hover:text-gray-600 hover:bg-gray-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
      )}
    >
      <span
        className={cn(
          "transition-opacity duration-100",
          copied ? "opacity-0 absolute" : "opacity-100"
        )}
      >
        {!copied && <Copy className="size-3.5" />}
      </span>
      <span
        className={cn(
          "transition-opacity duration-100",
          !copied ? "opacity-0 absolute" : "opacity-100"
        )}
      >
        {copied && <Check className="size-3.5 text-green-500" />}
      </span>
    </button>
  );
}

// Stable entity icon — defined outside render
function EntityIcon({ entityType, className }: { entityType: EntityType; className?: string }) {
  const props = { className };
  switch (entityType) {
    case "EMAIL": return <Mail {...props} />;
    case "PHONE": return <Phone {...props} />;
    case "AADHAAR": return <Fingerprint {...props} />;
    case "PAN": return <CreditCard {...props} />;
    case "NAME": return <User {...props} />;
    case "ADDRESS": return <MapPin {...props} />;
    case "CARD_NUMBER": return <CreditCard {...props} />;
    case "UPI": return <Wallet {...props} />;
    case "CVV": return <ShieldAlert {...props} />;
    case "PASSPORT": return <Globe {...props} />;
    case "IP_ADDRESS": return <Globe {...props} />;
    case "DOB": return <Calendar {...props} />;
    default: return <ShieldAlert {...props} />;
  }
}

export function EntityDetailPanel({
  entity,
  lineNumber,
  occurrenceIndex,
  totalOccurrences,
  onClose,
  onPrevOccurrence,
  onNextOccurrence,
}: EntityDetailPanelProps) {
  const colors = getEntityColors(entity.entityType as EntityType);
  const confidencePercent = Math.round(entity.confidence * 100);
  const confBarColor = getConfidenceColor(entity.confidence);
  const layerLabel = getLayerLabel(entity.layer);

  return (
    <div
      role="complementary"
      aria-label="PII entity details"
      aria-live="polite"
      className={cn(
        "h-40 shrink-0 border-t bg-white shadow-lg",
        "flex items-stretch gap-0 overflow-hidden"
      )}
    >
      {/* ── Left: type + confidence ────────────────────────────── */}
      <div className="flex flex-col justify-center gap-2 px-5 w-52 shrink-0 border-r">
        {/* Entity type badge */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold",
              colors.chipBg,
              colors.chipText,
              colors.chipBorder
            )}
          >
            <EntityIcon entityType={entity.entityType as EntityType} className="size-3" />
            {entity.entityType}
          </span>
        </div>

        {/* Detection layer */}
        <p className="text-xs text-gray-500">
          Detected by{" "}
          <span className="font-medium text-gray-700">{layerLabel}</span>
        </p>

        {/* Confidence bar */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Confidence</span>
            <span className="text-xs font-medium text-gray-700">
              {confidencePercent}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", confBarColor)}
              style={{ width: `${confidencePercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Center: original → masked ──────────────────────────── */}
      <div className="flex flex-1 items-center justify-center gap-4 px-6 min-w-0">
        {/* Original */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">Original value</span>
          <div className="flex items-center gap-1">
            <code
              className="text-[13px] font-mono bg-red-50 text-red-800 px-2 py-0.5 rounded border border-red-100 truncate max-w-48"
              title={entity.originalValue}
            >
              {entity.originalValue}
            </code>
            <CopyButton
              value={entity.originalValue}
              label="Copy original value"
            />
          </div>
        </div>

        <ArrowRight className="size-4 text-gray-400 shrink-0" />

        {/* Masked */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">Replaced with</span>
          <div className="flex items-center gap-1">
            <code
              className="text-[13px] font-mono bg-green-50 text-green-800 px-2 py-0.5 rounded border border-green-100 truncate max-w-48"
              title={entity.maskedValue}
            >
              {entity.maskedValue}
            </code>
            <CopyButton
              value={entity.maskedValue}
              label="Copy masked value"
            />
          </div>
        </div>
      </div>

      {/* ── Right: meta + occurrence nav ──────────────────────── */}
      <div className="flex flex-col justify-center gap-1.5 px-5 w-52 shrink-0 border-l">
        <div className="text-xs text-gray-500 space-y-0.5">
          <p>
            Line{" "}
            <span className="font-medium text-gray-700">{lineNumber}</span>
          </p>
          <p>
            Position{" "}
            <span className="font-medium text-gray-700">
              {entity.startIndex}–{entity.endIndex}
            </span>
          </p>
          {totalOccurrences > 1 && (
            <p>
              Occurrence{" "}
              <span className="font-medium text-gray-700">
                {occurrenceIndex + 1} of {totalOccurrences}
              </span>
            </p>
          )}
        </div>

        {totalOccurrences > 1 && (
          <div className="flex items-center gap-1 mt-1">
            <button
              type="button"
              aria-label="Previous occurrence"
              onClick={onPrevOccurrence}
              disabled={occurrenceIndex === 0}
              className={cn(
                "flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded border",
                "text-gray-500 border-gray-200 hover:bg-gray-50 disabled:opacity-40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
                "transition-colors duration-100"
              )}
            >
              <ChevronLeft className="size-3" />
              Prev
            </button>
            <button
              type="button"
              aria-label="Next occurrence"
              onClick={onNextOccurrence}
              disabled={occurrenceIndex === totalOccurrences - 1}
              className={cn(
                "flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded border",
                "text-gray-500 border-gray-200 hover:bg-gray-50 disabled:opacity-40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
                "transition-colors duration-100"
              )}
            >
              Next
              <ChevronRight className="size-3" />
            </button>
          </div>
        )}
      </div>

      {/* ── Close button ───────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Close entity details"
        onClick={onClose}
        className={cn(
          "absolute top-2 right-2 p-1 rounded text-gray-400",
          "hover:text-gray-600 hover:bg-gray-100 transition-colors duration-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        )}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
