import prisma from "@/lib/db";
import { AuditFilterTable, type AuditRow } from "@/components/admin/AuditFilterTable";

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
    detail: l.detail ?? undefined,
    ipAddress: l.ipAddress ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
          {total} entries
        </span>
      </div>
      <AuditFilterTable logs={logs} />
    </div>
  );
}
