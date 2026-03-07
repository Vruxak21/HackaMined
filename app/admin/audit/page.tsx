import prisma from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { AuditFilterTable, type AuditRow } from "@/components/admin/AuditFilterTable";
import { ClipboardList, Download } from "lucide-react";

export default async function AdminAuditPage() {
  const [dbLogs, total] = await Promise.all([
    prisma.auditLog.findMany({
      take: 100,
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        timestamp: true,
        action: true,
        detail: true,
        ipAddress: true,
        user: { select: { email: true } },
        file: { select: { originalName: true } },
      },
    }),
    prisma.auditLog.count(),
  ]);

  const logs: AuditRow[] = dbLogs.map((l) => ({
    id: l.id,
    timestamp: l.timestamp.toISOString(),
    userEmail: l.user.email,
    action: l.action as AuditRow["action"],
    fileName: l.file?.originalName,
    detail: decrypt(l.detail) ?? undefined,
    ipAddress: decrypt(l.ipAddress) ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 animate-fade-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Audit Log
            </h1>
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {total.toLocaleString()} entries
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete record of all system activity
          </p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-all duration-150 hover:bg-muted active:scale-[0.97]">
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <AuditFilterTable logs={logs} />
    </div>
  );
}

