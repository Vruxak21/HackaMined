import React, { useCallback } from "react";
import { cn } from "@/lib/utils";
import { getEntityColors } from "@/lib/diff/entityColors";
import type { DiffLineData, DiffSide, EntityType, Segment } from "@/lib/diff/diffTypes";

interface DiffLineProps {
  data: DiffLineData;
  side: DiffSide;
  focusedEntityId: string | null;
  activeFilter: string | null;
  onEntityClick: (entityId: string) => void;
  isMono: boolean;
  style?: React.CSSProperties;
}

// ─── Individual segment span ──────────────────────────────────────────────────

interface SegmentSpanProps {
  segment: Segment;
  side: DiffSide;
  isFocused: boolean;
  isDimmed: boolean;
  onEntityClick: (entityId: string) => void;
}

function SegmentSpan({ segment, side, isFocused, isDimmed, onEntityClick }: SegmentSpanProps) {
  const handleClick = useCallback(() => {
    if (segment.entityId) onEntityClick(segment.entityId);
  }, [segment.entityId, onEntityClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && segment.entityId) {
        e.preventDefault();
        onEntityClick(segment.entityId);
      }
    },
    [segment.entityId, onEntityClick]
  );

  if (!segment.isPii) {
    return <span>{segment.text}</span>;
  }

  const colors = getEntityColors(segment.entityType as EntityType);
  const bgClass = side === "original" ? colors.wordBgOrig : colors.wordBgSan;
  const textClass = side === "original" ? colors.wordTextOrig : colors.wordTextSan;

  return (
    <mark
      role="mark"
      aria-label={`${segment.entityType} detected: ${segment.text}`}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "rounded-[3px] px-0.75 cursor-pointer transition-all duration-150 select-text",
        bgClass,
        textClass,
        side === "original" && "line-through decoration-red-600/50",
        isFocused && [
          "ring-2 ring-offset-1",
          side === "original" ? "ring-red-500" : "ring-green-500",
          "animate-pii-pulse",
        ],
        isDimmed && "opacity-30",
        "hover:brightness-90"
      )}
    >
      {segment.text}
    </mark>
  );
}

// ─── DiffLine ─────────────────────────────────────────────────────────────────

export function DiffLine({
  data,
  side,
  focusedEntityId,
  activeFilter,
  onEntityClick,
  isMono,
  style,
}: DiffLineProps) {
  const segments =
    side === "original" ? data.originalSegments : data.sanitizedSegments;

  const hasChanges = data.hasChanges;
  const lineBg =
    hasChanges
      ? side === "original"
        ? "bg-red-50"
        : "bg-green-50"
      : "bg-white";

  // Determine if this line has the focused entity
  const lineHasFocused = segments.some((s) => s.entityId === focusedEntityId);

  // Which unique entity types appear on this line
  const lineEntityTypes = Array.from(
    new Set(segments.filter((s) => s.isPii && s.entityType).map((s) => s.entityType as EntityType))
  );

  // Line number tint — use the first entity type's tint color
  const lineNumExtraClass =
    hasChanges && lineEntityTypes.length > 0
      ? getEntityColors(lineEntityTypes[0]).lineNumTint
      : "text-gray-400";

  return (
    <div
      className={cn(
        "flex min-h-5.5 group",
        lineBg,
        lineHasFocused && "ring-1 ring-inset ring-current/20"
      )}
      style={style}
    >
      {/* Line number gutter */}
      <div
        className={cn(
          "w-12 shrink-0 text-right pr-3 text-xs font-mono select-none leading-5.5",
          lineNumExtraClass
        )}
        aria-hidden="true"
      >
        {data.lineNumber}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 px-4 text-[13px] leading-5.5 whitespace-pre-wrap break-all min-w-0",
          isMono ? "font-mono" : "font-sans"
        )}
      >
        {segments.map((seg, idx) => {
          const isFocused = !!seg.entityId && seg.entityId === focusedEntityId;
          const isDimmed =
            !!activeFilter &&
            seg.isPii &&
            seg.entityType !== activeFilter;

          return (
            <SegmentSpan
              key={idx}
              segment={seg}
              side={side}
              isFocused={isFocused}
              isDimmed={isDimmed}
              onEntityClick={onEntityClick}
            />
          );
        })}
      </div>
    </div>
  );
}
