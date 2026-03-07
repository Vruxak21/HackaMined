import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsedSectionProps {
  startLine: number;
  endLine: number;
  count: number;
  onExpand: (startLine: number) => void;
  className?: string;
}

export function CollapsedSection({
  startLine,
  endLine,
  count,
  onExpand,
  className,
}: CollapsedSectionProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1 px-4 bg-gray-50 border-y border-dashed border-gray-200 text-gray-400 text-xs select-none",
        className
      )}
    >
      {/* Left gutter to align with line number column */}
      <div className="w-12 shrink-0" aria-hidden="true" />

      {/* Decorative lines */}
      <span className="text-gray-300" aria-hidden="true">┄┄┄┄</span>

      <span className="font-mono">
        {count} unchanged {count === 1 ? "line" : "lines"}
        {" "}
        <span className="text-gray-300">
          ({startLine}–{endLine})
        </span>
      </span>

      <span className="text-gray-300" aria-hidden="true">┄┄┄┄</span>

      <button
        type="button"
        aria-expanded={false}
        aria-label={`Show ${count} unchanged lines`}
        onClick={() => onExpand(startLine)}
        className={cn(
          "ml-auto flex items-center gap-1 rounded px-2 py-0.5",
          "text-xs text-gray-500 border border-gray-200 bg-white",
          "hover:bg-gray-100 hover:text-gray-700 transition-colors duration-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        )}
      >
        <ChevronDown className="size-3" />
        Show
      </button>
    </div>
  );
}
