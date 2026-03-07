import React, { useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getEntityColors, getEntityIcon } from "@/lib/diff/entityColors";
import type { EntityType, PiiEntity } from "@/lib/diff/diffTypes";

interface DiffFilterBarProps {
  entities: PiiEntity[];
  activeFilter: string | null;
  onFilterChange: (entityType: string | null) => void;
  focusedIndex: number;
  totalVisible: number;
  onPrev: () => void;
  onNext: () => void;
  onJumpToFirst: () => void;
}

export function DiffFilterBar({
  entities,
  activeFilter,
  onFilterChange,
  focusedIndex,
  totalVisible,
  onPrev,
  onNext,
  onJumpToFirst,
}: DiffFilterBarProps) {
  // Collect unique entity types present in the list, in first-seen order
  const uniqueTypes = Array.from(
    new Set(entities.map((e) => e.entityType))
  ) as EntityType[];

  const handleFilterClick = useCallback(
    (type: string | null) => {
      onFilterChange(type);
    },
    [onFilterChange]
  );

  return (
    <div
      className={cn(
        "flex items-center gap-3 h-11 px-4 border-b bg-gray-50/50",
        "shrink-0 overflow-x-auto"
      )}
    >
      {/* ── Filter label ──────────────────────────────────────── */}
      <span className="text-xs text-gray-500 font-medium whitespace-nowrap shrink-0">
        Filter by type:
      </span>

      {/* ── All pill ─────────────────────────────────────────── */}
      <FilterPill
        label="All"
        isActive={activeFilter === null}
        onClick={() => handleFilterClick(null)}
        chipBg="bg-gray-100"
        chipText="text-gray-700"
        chipBorder="border-gray-200"
        activeBg="bg-gray-700"
        activeText="text-white"
        icon={null}
      />

      {/* ── Entity type pills ────────────────────────────────── */}
      {uniqueTypes.map((type) => {
        const colors = getEntityColors(type);
        const Icon = getEntityIcon(type);
        const count = entities.filter((e) => e.entityType === type).length;

        return (
          <FilterPill
            key={type}
            label={`${type} × ${count}`}
            isActive={activeFilter === type}
            onClick={() =>
              handleFilterClick(activeFilter === type ? null : type)
            }
            chipBg={colors.chipBg}
            chipText={colors.chipText}
            chipBorder={colors.chipBorder}
            activeBg={colors.wordBgSan}
            activeText={colors.wordTextSan}
            icon={<Icon className="size-3 shrink-0" />}
          />
        );
      })}

      {/* ── Spacer ───────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Navigation ───────────────────────────────────────── */}
      {totalVisible > 0 && (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-label="Jump to first PII entity"
            onClick={onJumpToFirst}
            className={cn(
              "text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded px-1"
            )}
          >
            <ChevronsLeft className="size-3.5 inline-block mr-0.5" />
            First
          </button>

          <button
            type="button"
            aria-label="Previous PII entity"
            onClick={onPrev}
            disabled={focusedIndex <= 0}
            className={cn(
              "flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border",
              "text-gray-600 border-gray-200 bg-white hover:bg-gray-50",
              "disabled:opacity-40 transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            )}
          >
            <ChevronLeft className="size-3.5" />
            Prev
          </button>

          <span className="text-xs font-mono font-medium text-gray-600 min-w-13 text-center">
            {totalVisible === 0 ? "0 of 0" : `${focusedIndex + 1} of ${totalVisible}`}
          </span>

          <button
            type="button"
            aria-label="Next PII entity"
            onClick={onNext}
            disabled={focusedIndex >= totalVisible - 1}
            className={cn(
              "flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border",
              "text-gray-600 border-gray-200 bg-white hover:bg-gray-50",
              "disabled:opacity-40 transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            )}
          >
            Next
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}

      {totalVisible === 0 && (
        <span className="text-xs text-gray-400 shrink-0">No matches</span>
      )}
    </div>
  );
}

// ─── Filter pill ─────────────────────────────────────────────────────────────

interface FilterPillProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  chipBg: string;
  chipText: string;
  chipBorder: string;
  activeBg: string;
  activeText: string;
  icon: React.ReactNode;
}

function FilterPill({
  label,
  isActive,
  onClick,
  chipBg,
  chipText,
  chipBorder,
  activeBg,
  activeText,
  icon,
}: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium",
        "transition-all duration-75 whitespace-nowrap shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        "active:scale-105",
        isActive
          ? [activeBg, activeText, "border-transparent shadow-sm"]
          : [chipBg, chipText, chipBorder, "hover:brightness-95"]
      )}
    >
      {icon}
      {label}
    </button>
  );
}
