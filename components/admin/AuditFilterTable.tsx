"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditRow = {
  id: string;
  timestamp: Date | string;
  userEmail: string;
  action: "LOGIN" | "LOGOUT" | "UPLOAD" | "SCAN" | "DOWNLOAD" | "VIEW" | "DELETE";
  fileName?: string;
  detail?: string;
  ipAddress?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const actionStyle: Record<AuditRow["action"], { bg: string; text: string }> = {
  UPLOAD:   { bg: "bg-blue-100",   text: "text-blue-700" },
  SCAN:     { bg: "bg-purple-100", text: "text-purple-700" },
  DOWNLOAD: { bg: "bg-green-100",  text: "text-green-700" },
  VIEW:     { bg: "bg-gray-100",   text: "text-gray-600" },
  LOGIN:    { bg: "bg-yellow-100", text: "text-yellow-700" },
  LOGOUT:   { bg: "bg-orange-100", text: "text-orange-700" },
  DELETE:   { bg: "bg-red-100",    text: "text-red-700" },
};

type FilterTab = "ALL" | AuditRow["action"];

const TABS: { value: FilterTab; label: string }[] = [
  { value: "ALL",      label: "All" },
  { value: "UPLOAD",   label: "Upload" },
  { value: "SCAN",     label: "Scan" },
  { value: "DOWNLOAD", label: "Download" },
  { value: "VIEW",     label: "View" },
];

function formatTimestamp(d: Date | string) {
  const dt = new Date(d);
  return {
    date: dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    time: dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditFilterTable({ logs }: { logs: AuditRow[] }) {
  const [tab, setTab] = useState<FilterTab>("ALL");

  const filtered = useMemo(
    () => (tab === "ALL" ? logs : logs.filter((l) => l.action === tab)),
    [logs, tab]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-800"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Count */}
      <p className="text-xs text-gray-500">
        Showing <span className="font-semibold text-gray-700">{filtered.length}</span> entries
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Timestamp</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>IP Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center text-sm text-gray-400">
                  No log entries for this filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((log) => {
                const { date, time } = formatTimestamp(log.timestamp);
                const { bg, text } = actionStyle[log.action];
                return (
                  <TableRow key={log.id} className="hover:bg-gray-50/50">
                    {/* Timestamp */}
                    <TableCell>
                      <p className="text-sm text-gray-700">{date}</p>
                      <p className="text-xs text-gray-400">{time}</p>
                    </TableCell>
                    {/* User */}
                    <TableCell className="text-sm text-gray-700">{log.userEmail}</TableCell>
                    {/* Action */}
                    <TableCell>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", bg, text)}>
                        {log.action}
                      </span>
                    </TableCell>
                    {/* File */}
                    <TableCell className="text-sm text-gray-600">
                      {log.fileName ?? <span className="text-gray-300">—</span>}
                    </TableCell>
                    {/* Detail */}
                    <TableCell className="max-w-50">
                      <p className="truncate text-xs text-gray-500">{log.detail ?? "—"}</p>
                    </TableCell>
                    {/* IP */}
                    <TableCell className="text-xs text-gray-400">{log.ipAddress ?? "—"}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
