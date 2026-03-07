import prisma from "@/lib/db";
import { FilesSearchTable, type FileRow } from "@/components/admin/FilesSearchTable";
import { Files, Upload } from "lucide-react";
import Link from "next/link";

export default async function AdminFilesPage() {
  const dbFiles = await prisma.file.findMany({
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      originalName: true,
      fileType: true,
      status: true,
      totalPiiFound: true,
      maskingMode: true,
      uploadedAt: true,
      uploader: { select: { email: true } },
    },
  });

  const files: FileRow[] = dbFiles.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    fileType: f.fileType,
    status: f.status,
    totalPiiFound: f.totalPiiFound,
    maskingMode: f.maskingMode as "redact" | "mask" | "tokenize",
    uploadedAt: f.uploadedAt.toISOString(),
    uploadedBy: f.uploader.email,
  }));

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 animate-fade-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            All Files
          </h1>
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {files.length}
          </span>
        </div>
        <Link
          href="/admin/upload"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.97]"
        >
          <Upload size={14} />
          Upload File
        </Link>
      </div>

      {/* Table */}
      <FilesSearchTable files={files} />

      {/* Empty state */}
      {files.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Files size={48} className="mb-4 text-muted-foreground/30" />
          <h3 className="font-display text-lg font-semibold text-foreground">No files yet</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">Upload your first file to start detecting PII</p>
          <Link
            href="/admin/upload"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
          >
            <Upload size={14} />
            Upload File
          </Link>
        </div>
      )}
    </div>
  );
}

