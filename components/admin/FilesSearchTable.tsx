"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  FileText,
  FileSpreadsheet,
  FileJson,
  FileCode2,
  Image,
  File,
  Loader2,
  Files,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export type FileRow = {
  id: string;
  originalName: string;
  fileType: string;
  status: "PROCESSING" | "DONE" | "FAILED";
  totalPiiFound: number;
  maskingMode: "redact" | "mask" | "tokenize";
  uploadedAt: Date | string;
  uploadedBy: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function FileIcon({ type }: { type: string }) {
  const cls = "size-4 shrink-0";
  switch (type.toLowerCase()) {
    case "pdf":   return <FileText className={cn(cls, "text-red-500")} />;
    case "csv":   return <FileSpreadsheet className={cn(cls, "text-green-600")} />;
    case "json":  return <FileJson className={cn(cls, "text-yellow-500")} />;
    case "docx":  return <File className={cn(cls, "text-blue-500")} />;
    case "sql":   return <FileCode2 className={cn(cls, "text-purple-500")} />;
    case "txt":   return <FileText className={cn(cls, "text-gray-400")} />;
    case "png":
    case "jpg":
    case "jpeg":  return <Image className={cn(cls, "text-pink-500")} />;
    default:      return <File className={cn(cls, "text-gray-400")} />;
  }
}

const statusStyle: Record<FileRow["status"], { bg: string; text: string; dot: string; label: string }> = {
  PROCESSING: { bg: "bg-warning-bg border border-warning-border", text: "text-warning", dot: "bg-warning", label: "Processing" },
  DONE:       { bg: "bg-success-bg border border-success-border", text: "text-success", dot: "bg-success", label: "Done" },
  FAILED:     { bg: "bg-danger-bg border border-danger-border",   text: "text-danger",  dot: "bg-danger",  label: "Failed" },
};

const modeStyle: Record<FileRow["maskingMode"], { bg: string; text: string }> = {
  redact:   { bg: "bg-danger-bg border border-danger-border",   text: "text-danger" },
  mask:     { bg: "bg-warning-bg border border-warning-border", text: "text-warning" },
  tokenize: { bg: "bg-info-bg border border-info-border",       text: "text-info" },
};

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FilesSearchTable({ files }: { files: FileRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      files.filter(
        (f) =>
          f.originalName.toLowerCase().includes(query.toLowerCase()) ||
          f.uploadedBy.toLowerCase().includes(query.toLowerCase())
      ),
    [files, query]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name or user…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Files size={36} className="opacity-40" />
          <p className="text-sm font-medium">
            {query ? "No files match your search." : "No files uploaded yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">File</TableHead>
                <TableHead className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">Uploaded By</TableHead>
                <TableHead className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                <TableHead className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">PII Found</TableHead>
                <TableHead className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">Masking Mode</TableHead>
                <TableHead className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">Date</TableHead>
                <TableHead className="text-right text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((file) => {
                const s = statusStyle[file.status];
                const m = modeStyle[file.maskingMode];
                return (
                  <TableRow key={file.id} className="hover:bg-muted/40 transition-colors duration-100">
                    {/* File */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileIcon type={file.fileType} />
                        <span className="max-w-45 truncate text-sm font-medium text-foreground">
                          {file.originalName}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase text-muted-foreground">  
                          {file.fileType}
                        </span>
                      </div>
                    </TableCell>
                    {/* Uploaded By */}
                    <TableCell className="font-code text-xs text-muted-foreground">{file.uploadedBy}</TableCell>
                    {/* Status */}
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold", s.bg, s.text)}>
                        {file.status === "PROCESSING"
                          ? <Loader2 size={10} className="animate-spin" />
                          : <span className={cn("size-1.5 rounded-full", s.dot)} />}
                        {s.label}
                      </span>
                    </TableCell>
                    {/* PII Found */}
                    <TableCell>
                      {file.totalPiiFound > 0 ? (
                        <span className="font-display text-sm font-bold tabular-nums text-danger">{file.totalPiiFound}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {/* Masking Mode */}
                    <TableCell>
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold capitalize", m.bg, m.text)}>
                        {file.maskingMode}
                      </span>
                    </TableCell>
                    {/* Date */}
                    <TableCell className="text-xs text-muted-foreground">{formatDate(file.uploadedAt)}</TableCell>
                    {/* Actions */}
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/files/${file.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
