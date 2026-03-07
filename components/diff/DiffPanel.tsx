import React, { useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { DiffLine } from "./DiffLine";
import { CollapsedSection } from "./CollapsedSection";
import type { DiffSide, VirtualRow } from "@/lib/diff/diffTypes";

const LINE_HEIGHT = 22; // px — matches min-h-[22px] in DiffLine
const COLLAPSED_HEIGHT = 32; // px — CollapsedSection row height

interface DiffPanelProps {
  rows: VirtualRow[];
  side: DiffSide;
  label: string;
  focusedEntityId: string | null;
  activeFilter: string | null;
  onEntityClick: (entityId: string) => void;
  onExpandSection: (startLine: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  isMono: boolean;
}

export function DiffPanel({
  rows,
  side,
  label,
  focusedEntityId,
  activeFilter,
  onEntityClick,
  onExpandSection,
  scrollRef,
  onScroll,
  isMono,
}: DiffPanelProps) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row?.kind === "collapsed" ? COLLAPSED_HEIGHT : LINE_HEIGHT;
    },
    overscan: 10,
  });

  // Expose scrollToIndex for navigation
  const scrollToLine = useCallback(
    (lineNumber: number) => {
      const targetIdx = rows.findIndex(
        (r) => r.kind === "line" && r.data.lineNumber === lineNumber
      );
      if (targetIdx !== -1) {
        virtualizer.scrollToIndex(targetIdx, { align: "center", behavior: "smooth" });
      }
    },
    [rows, virtualizer]
  );

  // Store scrollToLine on the scrollRef so the parent can call it
  useEffect(() => {
    if (scrollRef.current) {
      (scrollRef.current as HTMLDivElement & { scrollToLine?: (n: number) => void }).scrollToLine =
        scrollToLine;
    }
  }, [scrollRef, scrollToLine]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      role="region"
      aria-label={label}
      className="flex flex-col h-full"
    >
      {/* Panel header */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-1.5 border-b text-xs font-medium select-none shrink-0",
          side === "original"
            ? "bg-red-50/60 text-red-700 border-red-100"
            : "bg-green-50/60 text-green-700 border-green-100"
        )}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            side === "original" ? "bg-red-400" : "bg-green-400"
          )}
          aria-hidden="true"
        />
        {label}
      </div>

      {/* Virtualized scroll container */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto"
        style={{ contain: "strict" }}
      >
        {/* Total height spacer (required by react-virtual) */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((vItem) => {
            const row = rows[vItem.index];
            if (!row) return null;

            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                {row.kind === "collapsed" ? (
                  <CollapsedSection
                    startLine={row.startLine}
                    endLine={row.endLine}
                    count={row.count}
                    onExpand={onExpandSection}
                  />
                ) : (
                  <DiffLine
                    data={row.data}
                    side={side}
                    focusedEntityId={focusedEntityId}
                    activeFilter={activeFilter}
                    onEntityClick={onEntityClick}
                    isMono={isMono}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
