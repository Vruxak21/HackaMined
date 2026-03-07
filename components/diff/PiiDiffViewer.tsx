"use client";

import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { cn } from "@/lib/utils";
import { DiffHeader } from "./DiffHeader";
import { DiffFilterBar } from "./DiffFilterBar";
import { DiffPanel } from "./DiffPanel";
import { EntityDetailPanel } from "./EntityDetailPanel";
import { DiffLine } from "./DiffLine";
import {
  buildDiffLines,
  buildVirtualRows,
  getVisibleEntities,
  getEntityLineNumber,
  findOccurrences,
} from "@/lib/diff/buildDiffLines";
import { isMonoFont } from "@/lib/diff/entityColors";
import type {
  DiffLineData,
  DiffStats,
  EntityType,
  FileType,
  PiiEntity,
  ViewMode,
} from "@/lib/diff/diffTypes";
import { ShieldCheck } from "lucide-react";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PiiDiffViewerProps {
  originalText: string;
  sanitizedText: string;
  piiEntities: PiiEntity[];
  fileName: string;
  fileType: FileType;
  stats: DiffStats;
  onDownloadSanitized?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PiiDiffViewer({
  originalText,
  sanitizedText,
  piiEntities,
  fileName,
  fileType,
  stats,
  onDownloadSanitized,
}: PiiDiffViewerProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<PiiEntity | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set()
  );

  // ── Refs for synchronized scrolling ──────────────────────────────────────
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  // ── Memoized diff computation ─────────────────────────────────────────────
  const diffLines = useMemo(
    () => buildDiffLines(originalText, sanitizedText, piiEntities),
    [originalText, sanitizedText, piiEntities]
  );

  // ── Virtual rows (with collapsed sections) ────────────────────────────────
  const virtualRows = useMemo(
    () => buildVirtualRows(diffLines, expandedSections),
    [diffLines, expandedSections]
  );

  // ── Visible entities (filtered) ───────────────────────────────────────────
  const visibleEntities = useMemo(
    () => getVisibleEntities(piiEntities, activeFilter),
    [piiEntities, activeFilter]
  );

  // Sorted by position
  const sortedVisibleEntities = useMemo(
    () => [...visibleEntities].sort((a, b) => a.startIndex - b.startIndex),
    [visibleEntities]
  );

  // Current focused entity index in sortedVisibleEntities
  const focusedIndex = useMemo(() => {
    if (!focusedEntityId) return -1;
    return sortedVisibleEntities.findIndex((e) => e.id === focusedEntityId);
  }, [focusedEntityId, sortedVisibleEntities]);

  // ── isMono ────────────────────────────────────────────────────────────────
  const isMono = isMonoFont(fileType);

  // ── Synchronized scrolling ────────────────────────────────────────────────
  const handleLeftScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      if (rightPanelRef.current) {
        rightPanelRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
      }
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    },
    []
  );

  const handleRightScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      if (leftPanelRef.current) {
        leftPanelRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
      }
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    },
    []
  );

  // ── Entity click → open detail panel + set focused ───────────────────────
  const handleEntityClick = useCallback(
    (entityId: string) => {
      const entity = piiEntities.find((e) => e.id === entityId) ?? null;
      setSelectedEntity(entity);
      setFocusedEntityId(entityId);
    },
    [piiEntities]
  );

  // ── Navigate between entities ─────────────────────────────────────────────
  const navigateTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= sortedVisibleEntities.length) return;
      const entity = sortedVisibleEntities[index];
      setFocusedEntityId(entity.id);
      setSelectedEntity(entity);

      // Scroll both panels to entity line
      const lineNum = getEntityLineNumber(entity, originalText);
      const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
        const el = ref.current as (HTMLDivElement & { scrollToLine?: (n: number) => void }) | null;
        if (el?.scrollToLine) el.scrollToLine(lineNum);
      };
      scrollTo(leftPanelRef);
      scrollTo(rightPanelRef);
    },
    [sortedVisibleEntities, originalText]
  );

  const handlePrev = useCallback(() => {
    navigateTo(focusedIndex - 1);
  }, [focusedIndex, navigateTo]);

  const handleNext = useCallback(() => {
    navigateTo(focusedIndex + 1);
  }, [focusedIndex, navigateTo]);

  const handleJumpToFirst = useCallback(() => {
    navigateTo(0);
  }, [navigateTo]);

  // ── Filter change → reset navigation ─────────────────────────────────────
  const handleFilterChange = useCallback((entityType: string | null) => {
    setActiveFilter(entityType);
    setFocusedEntityId(null);
  }, []);

  // ── Expand collapsed section ──────────────────────────────────────────────
  const handleExpandSection = useCallback((startLine: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.add(startLine);
      return next;
    });
  }, []);

  // ── Close detail panel ────────────────────────────────────────────────────
  const handleCloseDetail = useCallback(() => {
    setSelectedEntity(null);
  }, []);

  // ── Occurrence navigation in detail panel ─────────────────────────────────
  const occurrences = useMemo(
    () => (selectedEntity ? findOccurrences(piiEntities, selectedEntity) : []),
    [selectedEntity, piiEntities]
  );

  const occurrenceIndex = useMemo(() => {
    if (!selectedEntity) return 0;
    return occurrences.findIndex((e) => e.id === selectedEntity.id);
  }, [selectedEntity, occurrences]);

  const handlePrevOccurrence = useCallback(() => {
    if (occurrenceIndex <= 0) return;
    const prev = occurrences[occurrenceIndex - 1];
    setSelectedEntity(prev);
    setFocusedEntityId(prev.id);
    const lineNum = getEntityLineNumber(prev, originalText);
    const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
      const el = ref.current as (HTMLDivElement & { scrollToLine?: (n: number) => void }) | null;
      if (el?.scrollToLine) el.scrollToLine(lineNum);
    };
    scrollTo(leftPanelRef);
    scrollTo(rightPanelRef);
  }, [occurrenceIndex, occurrences, originalText]);

  const handleNextOccurrence = useCallback(() => {
    if (occurrenceIndex >= occurrences.length - 1) return;
    const next = occurrences[occurrenceIndex + 1];
    setSelectedEntity(next);
    setFocusedEntityId(next.id);
    const lineNum = getEntityLineNumber(next, originalText);
    const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
      const el = ref.current as (HTMLDivElement & { scrollToLine?: (n: number) => void }) | null;
      if (el?.scrollToLine) el.scrollToLine(lineNum);
    };
    scrollTo(leftPanelRef);
    scrollTo(rightPanelRef);
  }, [occurrenceIndex, occurrences, originalText]);

  // ── Selected entity line number ───────────────────────────────────────────
  const selectedEntityLineNumber = useMemo(() => {
    if (!selectedEntity) return 0;
    return getEntityLineNumber(selectedEntity, originalText);
  }, [selectedEntity, originalText]);

  // ── No PII detected case ──────────────────────────────────────────────────
  const hasNoPii = piiEntities.length === 0;

  // ── Unified view lines ────────────────────────────────────────────────────
  // For unified view, produce flat list of {type: "orig"|"san"|"unchanged", data}
  const unifiedLines = useMemo(() => {
    if (viewMode !== "unified") return [];
    type UnifiedRow =
      | { kind: "unchanged"; data: DiffLineData }
      | { kind: "orig"; data: DiffLineData }
      | { kind: "san"; data: DiffLineData };

    const result: UnifiedRow[] = [];
    for (const line of diffLines) {
      if (line.hasChanges) {
        result.push({ kind: "orig", data: line });
        result.push({ kind: "san", data: line });
      } else {
        result.push({ kind: "unchanged", data: line });
      }
    }
    return result;
  }, [diffLines, viewMode]);

  // ── Focus view (only changed lines) ──────────────────────────────────────
  const focusLines = useMemo(
    () =>
      viewMode === "focus"
        ? diffLines.filter((l) => l.hasChanges)
        : [],
    [diffLines, viewMode]
  );

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "flex flex-col h-full min-h-0 rounded-lg border border-gray-200 bg-white overflow-hidden",
        "shadow-sm"
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <DiffHeader
        fileName={fileName}
        fileType={fileType}
        stats={stats}
        entities={piiEntities}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sanitizedText={sanitizedText}
        onDownloadSanitized={onDownloadSanitized}
      />

      {/* ── Filter + nav bar ───────────────────────────────────────────── */}
      <DiffFilterBar
        entities={piiEntities}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
        focusedIndex={Math.max(focusedIndex, 0)}
        totalVisible={sortedVisibleEntities.length}
        onPrev={handlePrev}
        onNext={handleNext}
        onJumpToFirst={handleJumpToFirst}
      />

      {/* ── No-PII banner ─────────────────────────────────────────────── */}
      {hasNoPii && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-gray-400">
          <ShieldCheck className="size-10 text-green-400" />
          <p className="text-sm font-medium text-gray-600">
            No PII detected in this file.
          </p>
          <p className="text-xs text-gray-400">
            The document appears clean. No sensitive data was found.
          </p>
        </div>
      )}

      {/* ── Main diff area ─────────────────────────────────────────────── */}
      {!hasNoPii && viewMode === "split" && (
        <div className="flex flex-1 min-h-0 overflow-hidden divide-x divide-gray-200">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <DiffPanel
              rows={virtualRows}
              side="original"
              label="Original"
              focusedEntityId={focusedEntityId}
              activeFilter={activeFilter}
              onEntityClick={handleEntityClick}
              onExpandSection={handleExpandSection}
              scrollRef={leftPanelRef}
              onScroll={handleLeftScroll}
              isMono={isMono}
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <DiffPanel
              rows={virtualRows}
              side="sanitized"
              label="Sanitized"
              focusedEntityId={focusedEntityId}
              activeFilter={activeFilter}
              onEntityClick={handleEntityClick}
              onExpandSection={handleExpandSection}
              scrollRef={rightPanelRef}
              onScroll={handleRightScroll}
              isMono={isMono}
            />
          </div>
        </div>
      )}

      {/* ── Unified view ──────────────────────────────────────────────── */}
      {!hasNoPii && viewMode === "unified" && (
        <div
          className="flex-1 overflow-auto min-h-0"
          role="region"
          aria-label="Unified diff view"
        >
          <div>
            {unifiedLines.map((row, idx) => {
              const { kind, data } = row;
              const side = kind === "orig" ? "original" : "sanitized";
              const prefix = kind === "orig" ? "−" : kind === "san" ? "+" : " ";
              const lineBg =
                kind === "orig"
                  ? "bg-red-50"
                  : kind === "san"
                  ? "bg-green-50"
                  : "bg-white";
              const prefixColor =
                kind === "orig"
                  ? "text-red-500"
                  : kind === "san"
                  ? "text-green-600"
                  : "text-gray-300";

              return (
                <div key={`${idx}-${data.lineNumber}-${kind}`} className={cn("flex", lineBg)}>
                  {/* Gutter: prefix */}
                  <div
                    className={cn(
                      "w-7 shrink-0 text-center text-xs font-mono select-none leading-5.5",
                      prefixColor
                    )}
                    aria-hidden="true"
                  >
                    {prefix}
                  </div>
                  {/* DiffLine handles its own line number & content */}
                  <div className="flex-1 min-w-0">
                    <DiffLine
                      data={data}
                      side={kind === "unchanged" ? "original" : side}
                      focusedEntityId={focusedEntityId}
                      activeFilter={activeFilter}
                      onEntityClick={handleEntityClick}
                      isMono={isMono}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Focus view ────────────────────────────────────────────────── */}
      {!hasNoPii && viewMode === "focus" && (
        <div
          className="flex-1 overflow-auto min-h-0 p-4 space-y-3"
          role="region"
          aria-label="Focus diff view"
        >
          {focusLines.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              No changed lines to display.
            </p>
          )}
          {focusLines.map((line, changeIdx) => {
            const entityTypesOnLine = Array.from(
              new Set(
                line.originalSegments
                  .filter((s) => s.isPii && s.entityType)
                  .map((s) => s.entityType as EntityType)
              )
            );
            const primaryType = entityTypesOnLine[0];

            return (
              <div
                key={line.lineNumber}
                className="rounded-md border border-gray-200 overflow-hidden shadow-sm"
              >
                {/* Card header */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">
                    Change {changeIdx + 1} of {focusLines.length}
                    <span className="font-normal text-gray-500 ml-1">
                      · Line {line.lineNumber}
                      {primaryType && ` · ${primaryType}`}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    {entityTypesOnLine.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded-full border text-[10px] font-medium bg-white"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Original line */}
                <div className="bg-red-50">
                  <DiffLine
                    data={line}
                    side="original"
                    focusedEntityId={focusedEntityId}
                    activeFilter={activeFilter}
                    onEntityClick={handleEntityClick}
                    isMono={isMono}
                  />
                </div>

                {/* Sanitized line */}
                <div className="bg-green-50">
                  <DiffLine
                    data={line}
                    side="sanitized"
                    focusedEntityId={focusedEntityId}
                    activeFilter={activeFilter}
                    onEntityClick={handleEntityClick}
                    isMono={isMono}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail panel ──────────────────────────────────────────────── */}
      <div
        className={cn(
          "transition-transform duration-200 ease-out relative",
          selectedEntity ? "translate-y-0" : "translate-y-full h-0 overflow-hidden"
        )}
      >
        {selectedEntity && (
          <EntityDetailPanel
            entity={selectedEntity}
            lineNumber={selectedEntityLineNumber}
            occurrenceIndex={occurrenceIndex}
            totalOccurrences={occurrences.length}
            onClose={handleCloseDetail}
            onPrevOccurrence={handlePrevOccurrence}
            onNextOccurrence={handleNextOccurrence}
          />
        )}
      </div>
    </div>
  );
}
