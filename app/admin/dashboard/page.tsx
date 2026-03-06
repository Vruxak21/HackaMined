import Link from "next/link";
import {
    Files,
    CheckCircle2,
    Users,
    ShieldAlert,
    ShieldCheck,
    ShieldOff,
    XCircle,
    FileText,
    FileSpreadsheet,
    FileJson,
    FileCode,
    Image,
    Loader2,
} from "lucide-react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import prisma from "@/lib/db";
import { headers } from "next/headers";
import { getEncryptionStatus } from "@/lib/get-encryption-status";
import type { EncryptionStatus } from "@/lib/get-encryption-status";
import { SecurityStatusCard } from "@/components/SecurityStatusCard";

// ── Types ─────────────────────────────────────────────────────────────────────

type FileStatus = "PROCESSING" | "DONE" | "FAILED";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: Date | string) {
    return new Date(iso).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

function todayLabel() {
    return new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

function FileTypeIcon({ type }: { type: string }) {
    const cls = "size-3.5 shrink-0";
    switch (type.toLowerCase()) {
        case "pdf": return <FileText className={`${cls} text-red-500`} />;
        case "sql": return <FileCode className={`${cls} text-violet-500`} />;
        case "docx": return <FileText className={`${cls} text-blue-500`} />;
        case "csv": return <FileSpreadsheet className={`${cls} text-emerald-600`} />;
        case "json": return <FileJson className={`${cls} text-amber-500`} />;
        case "jpg": case "jpeg": case "png":
            return <Image className={`${cls} text-pink-500`} />;
        default: return <FileText className={`${cls} text-muted-foreground`} />;
    }
}

function StatusBadge({ status }: { status: FileStatus }) {
    if (status === "PROCESSING") {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-700">
                <Loader2 className="size-2.5 animate-spin" />
                Processing
            </span>
        );
    }
    if (status === "DONE") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-700">
                Done
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-red-700">
            Failed
        </span>
    );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
    icon: React.ReactNode;
    value: number;
    label: string;
    subtext: string;
}

function StatCard({ icon, value, label, subtext }: StatCardProps) {
    return (
        <Card className="border border-border bg-card shadow-none">
            <CardContent className="pt-5 pb-5 px-5">
                <div className="flex items-start justify-between mb-3">
                    <div className="text-muted-foreground">{icon}</div>
                </div>
                <p className="text-2xl font-bold text-foreground tabular-nums">{value.toLocaleString("en-IN")}</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
            </CardContent>
        </Card>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminDashboardPage() {
    const [totalFiles, processed, failed, totalUsers, piiAggregate, recentFiles, encRes] =
        await Promise.all([
            prisma.file.count(),
            prisma.file.count({ where: { status: "DONE" } }),
            prisma.file.count({ where: { status: "FAILED" } }),
            prisma.user.count(),
            prisma.file.aggregate({ _sum: { totalPiiFound: true } }),
            prisma.file.findMany({
                take: 6,
                orderBy: { uploadedAt: "desc" },
                select: {
                    id: true,
                    originalName: true,
                    fileType: true,
                    status: true,
                    totalPiiFound: true,
                    uploadedAt: true,
                    uploader: { select: { email: true } },
                },
            }),
            (async () => {
                try {
                    const h = await headers();
                    const proto = h.get("x-forwarded-proto") ?? (h.get("host")?.includes("localhost") ? "https" : "http");
                    return await getEncryptionStatus(proto);
                } catch {
                    return null;
                }
            })(),
        ]);

    const stats = {
        totalFiles,
        processed,
        failed,
        totalUsers,
        totalPiiFound: piiAggregate._sum.totalPiiFound ?? 0,
    };

    return (
        <div className="min-h-full p-6 lg:p-8">
            {/* Page header */}
            <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-foreground tracking-tight">Dashboard</h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">PII Sanitization Overview</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1 shrink-0">{todayLabel()}</p>
            </div>

            {/* Stats grid */}
            <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                    icon={<Files size={16} />}
                    value={stats.totalFiles}
                    label="Total Files"
                    subtext="All uploaded files"
                />
                <StatCard
                    icon={<CheckCircle2 size={16} />}
                    value={stats.processed}
                    label="Processed"
                    subtext="PII sanitized"
                />
                <StatCard
                    icon={<Users size={16} />}
                    value={stats.totalUsers}
                    label="Users"
                    subtext="Admin + Standard"
                />
                <StatCard
                    icon={<ShieldAlert size={16} />}
                    value={stats.totalPiiFound}
                    label="PII Detected"
                    subtext="Across all files"
                />
            </div>

            {/* Security status */}
            <div className="mb-8">
                <SecurityStatusCard initial={encRes} />
            </div>

            {/* Recent uploads table */}
            <Card className="border border-border shadow-none">
                <CardHeader className="flex flex-row items-center justify-between pb-3 px-5 pt-5">
                    <CardTitle className="text-sm font-semibold text-foreground">
                        Recent Uploads
                    </CardTitle>
                    <Link
                        href="/admin/files"
                        className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                    >
                        View All →
                    </Link>
                </CardHeader>

                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-border hover:bg-transparent">
                                <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                                    File Name
                                </TableHead>
                                <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                                    Type
                                </TableHead>
                                <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                                    Uploaded By
                                </TableHead>
                                <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                                    Status
                                </TableHead>
                                <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                                    PII Found
                                </TableHead>
                                <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                                    Date
                                </TableHead>
                                <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                                    Action
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {recentFiles.map((file) => (
                                <TableRow
                                    key={file.id}
                                    className="border-border hover:bg-muted/40 transition-colors"
                                >
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <FileTypeIcon type={file.fileType} />
                                            <span
                                                className="max-w-40 truncate text-sm font-medium text-foreground"
                                                title={file.originalName}
                                            >
                                                {file.originalName}
                                            </span>
                                        </div>
                                    </TableCell>

                                    <TableCell>
                                        <Badge
                                            variant="secondary"
                                            className="rounded-sm text-[0.6rem] uppercase tracking-wider bg-muted text-muted-foreground hover:bg-muted border-0"
                                        >
                                            {file.fileType}
                                        </Badge>
                                    </TableCell>

                                    <TableCell>
                                        <span
                                            className="max-w-35 truncate block text-sm text-muted-foreground"
                                            title={file.uploader.email}
                                        >
                                            {file.uploader.email}
                                        </span>
                                    </TableCell>

                                    <TableCell>
                                        <StatusBadge status={file.status} />
                                    </TableCell>

                                    <TableCell>
                                        <span
                                            className={`text-sm font-semibold tabular-nums ${file.totalPiiFound > 0 ? "text-destructive" : "text-muted-foreground"
                                                }`}
                                        >
                                            {file.totalPiiFound > 0
                                                ? file.totalPiiFound.toLocaleString("en-IN")
                                                : "—"}
                                        </span>
                                    </TableCell>

                                    <TableCell>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDate(file.uploadedAt)}
                                        </span>
                                    </TableCell>

                                    <TableCell>
                                        <Link
                                            href={`/admin/files/${file.id}`}
                                            className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                                        >
                                            View →
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </Card>
        </div>
    );
}
