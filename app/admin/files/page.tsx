import prisma from "@/lib/db";
import { FilesSearchTable, type FileRow } from "@/components/admin/FilesSearchTable";

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
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-foreground tracking-tight">All Files</h1>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
          {files.length}
        </span>
      </div>
      <FilesSearchTable files={files} />
    </div>
  );
}
