import React, { useCallback } from "react";
import {
  Columns2,
  AlignJustify,
  Focus,
  MoreHorizontal,
  Copy,
  Download,
  FileText,
  Database,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getEntityColors, getEntityIcon } from "@/lib/diff/entityColors";
import type { DiffStats, EntityType, FileType, PiiEntity, ViewMode } from "@/lib/diff/diffTypes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

interface DiffHeaderProps {
  fileName: string;
  fileType: FileType;
  stats: DiffStats;
  entities: PiiEntity[];
  activeFilter: string | null;
  onFilterChange: (entityType: string | null) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sanitizedText: string;
  onDownloadSanitized?: () => void;
}

// ─── View mode buttons config ────────────────────────────────────────────────

const VIEW_MODES: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  {
    mode: "split",
    icon: <Columns2 className="size-4" />,
    label: "Split view",
  },
  {
    mode: "unified",
    icon: <AlignJustify className="size-4" />,
    label: "Unified view",
  },
  {
    mode: "focus",
    icon: <Focus className="size-4" />,
    label: "Focus view",
  },
];

// Stable file icon component — defined outside render to satisfy react-compiler
function FileTypeIcon({ fileType, className }: { fileType: FileType; className?: string }) {
  if (fileType === "png" || fileType === "jpg") return <ImageIcon className={className} />;
  if (fileType === "sql" || fileType === "csv" || fileType === "json") return <Database className={className} />;
  return <FileText className={className} />;
}

export function DiffHeader({
  fileName,
  fileType,
  stats,
  entities,
  activeFilter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  sanitizedText,
  onDownloadSanitized,
}: DiffHeaderProps) {
  const processingSeconds = (stats.processingTime / 1000).toFixed(1);

  // Unique entity types
  const uniqueTypes = Array.from(
    new Set(entities.map((e) => e.entityType))
  ) as EntityType[];

  const handleCopySanitized = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sanitizedText);
      toast.success("Sanitized content copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }, [sanitizedText]);

  const handleDownloadPiiCsv = useCallback(() => {
    const header = "Line,Entity Type,Original Value,Masked Value,Confidence,Layer\n";
    const rows = entities
      .map((e) => {
        const lineNum = 1; // We don't have line data here; parent should provide it
        const safe = (v: string) => `"${v.replace(/"/g, '""')}"`;
        return `${lineNum},${e.entityType},${safe(e.originalValue)},${safe(e.maskedValue)},${e.confidence.toFixed(2)},${e.layer}`;
      })
      .join("\n");
    downloadText(header + rows, `${fileName}-pii-report.csv`, "text/csv");
    toast.success("PII report CSV downloaded");
  }, [entities, fileName]);

  const handleDownloadPiiJson = useCallback(() => {
    const data = entities.map((e) => ({
      id: e.id,
      entityType: e.entityType,
      originalValue: e.originalValue,
      maskedValue: e.maskedValue,
      startIndex: e.startIndex,
      endIndex: e.endIndex,
      confidence: e.confidence,
      layer: e.layer,
    }));
    downloadText(
      JSON.stringify(data, null, 2),
      `${fileName}-pii-report.json`,
      "application/json"
    );
    toast.success("PII report JSON downloaded");
  }, [entities, fileName]);

  return (
    <div className="flex items-center gap-3 h-14 px-4 border-b bg-white shrink-0">
      {/* ── File info ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <FileTypeIcon fileType={fileType} className="size-4 text-gray-500 shrink-0" />

        <span className="font-semibold text-sm text-gray-900 truncate">
          {fileName}
        </span>

        <span className="text-gray-300 shrink-0" aria-hidden="true">·</span>

        <span className="text-xs text-gray-500 shrink-0">
          {stats.totalPiiFound} PII {stats.totalPiiFound === 1 ? "entity" : "entities"} detected
        </span>

        <span className="text-gray-300 shrink-0" aria-hidden="true">·</span>

        <span className="text-xs text-gray-400 shrink-0">
          Processed in {processingSeconds}s
        </span>
      </div>

      {/* ── Entity type chips ────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto shrink-0 max-w-sm">
        {uniqueTypes.map((type) => {
          const colors = getEntityColors(type);
          const Icon = getEntityIcon(type);
          const count = stats.byType[type] ?? 0;
          const isActive = activeFilter === type;

          return (
            <button
              key={type}
              type="button"
              onClick={() => onFilterChange(isActive ? null : type)}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium",
                "transition-all duration-75 whitespace-nowrap active:scale-105",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                isActive
                  ? [colors.wordBgSan, colors.wordTextSan, "border-transparent shadow-sm"]
                  : [colors.chipBg, colors.chipText, colors.chipBorder, "hover:brightness-95"]
              )}
              aria-pressed={isActive}
            >
              <Icon className="size-3 shrink-0" />
              {type} × {count}
            </button>
          );
        })}
      </div>

      {/* ── View toggle ───────────────────────────────────────── */}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center rounded-md border border-gray-200 bg-gray-50 p-0.5 gap-0.5 shrink-0">
          {VIEW_MODES.map(({ mode, icon, label }) => (
            <Tooltip key={mode}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={viewMode === mode}
                  onClick={() => onViewModeChange(mode)}
                  className={cn(
                    "p-1.5 rounded transition-all duration-100",
                    viewMode === mode
                      ? "bg-white shadow-sm text-gray-900"
                      : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  {icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>

      {/* ── Actions menu ─────────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className={cn(
              "p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100",
              "transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            )}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onClick={handleCopySanitized}
            className="text-xs gap-2"
          >
            <Copy className="size-3.5" />
            Copy sanitized text
          </DropdownMenuItem>
          {onDownloadSanitized && (
            <DropdownMenuItem
              onClick={onDownloadSanitized}
              className="text-xs gap-2"
            >
              <Download className="size-3.5" />
              Download sanitized file
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleDownloadPiiCsv}
            className="text-xs gap-2"
          >
            <Download className="size-3.5" />
            Download PII report (CSV)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDownloadPiiJson}
            className="text-xs gap-2"
          >
            <Download className="size-3.5" />
            Download PII report (JSON)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function downloadText(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
