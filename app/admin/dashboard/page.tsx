import Link from "next/link";
import {
    Files,
    CheckCircle2,
    Users,
    ShieldAlert,
    FileText,
    FileSpreadsheet,
    FileJson,
    FileCode,
    ImageIcon,
    Loader2,
    TrendingUp,
    Upload,
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
import { SecurityStatusCard } from "@/components/SecurityStatusCard";
import { AIModelStatusCard } from "@/components/AIModelStatusCard";
import { AnalyticsSection } from "@/components/charts/AnalyticsSection";

// ── Types ─────────────────────────────────────────────────────────────────────

type FileStatus = "PROCESSING" | "DONE" | "FAILED";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: Date | string) {
    return new Date(iso).toLocaleString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

function todayLabel() {
    return new Date().toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

function greetingLabel() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
}

function FileTypeIcon({ type }: { type: string }) {
    const cls = "size-3.5 shrink-0";
    switch (type.toLowerCase()) {
        case "pdf":  return <FileText className={`${cls} text-red-500`} />;
        case "sql":  return <FileCode className={`${cls} text-violet-500`} />;
        case "docx": return <FileText className={`${cls} text-blue-500`} />;
        case "csv":  return <FileSpreadsheet className={`${cls} text-emerald-600`} />;
        case "json": return <FileJson className={`${cls} text-amber-500`} />;
        case "jpg": case "jpeg": case "png":
            return <ImageIcon className={`${cls} text-pink-500`} />;
        default:     return <FileText className={`${cls} text-muted-foreground`} />;
    }
}

function StatusBadge({ status }: { status: FileStatus }) {
    if (status === "PROCESSING") {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-warning-border bg-warning-bg px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-warning">
                <Loader2 className="size-2.5 animate-spin" />
                Processing
            </span>
        );
    }
    if (status === "DONE") {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-success-border bg-success-bg px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-success">
                <span className="size-1.5 rounded-full bg-current" />
                Done
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-danger-border bg-danger-bg px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-danger">
            <span className="size-1.5 rounded-full bg-current" />
            Failed
        </span>
    );
}

// ── Metric Card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
    icon: React.ReactNode;
    iconBg: string;
    value: string | number;
    label: string;
    subtext: string;
    accent?: boolean;
}

function MetricCard({ icon, iconBg, value, label, subtext, accent }: MetricCardProps) {
    return (
        <Card className={`relative overflow-hidden border bg-card shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${accent ? "border-t-brand" : ""}`}>
            <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
                        {icon}
                    </div>
                    <TrendingUp size={12} className="text-muted-foreground/40 mt-1" />
                </div>
                <p className="font-display text-2xl font-bold text-foreground tabular-nums leading-none">
                    {typeof value === "number" ? value.toLocaleString() : value}
                </p>
                <p className="mt-1.5 text-sm font-semibold text-foreground">{label}</p>
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
                take: 8,
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
        <div className="min-h-full p-6 lg:p-8 animate-fade-slide-up">

            {/* ── Page Header ────────────────────────────────────────── */}
            <div className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                        {greetingLabel()}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">{todayLabel()}</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-success-border bg-success-bg px-3 py-1 text-xs font-semibold text-success">
                        <span className="size-1.5 animate-pulse-dot rounded-full bg-current" />
                        All Systems Operational
                    </span>
                    <Link
                        href="/admin/upload"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95"
                    >
                        <Upload size={12} />
                        Upload File
                    </Link>
                </div>
            </div>

            {/* ── Metric Cards ────────────────────────────────────────── */}
            <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <MetricCard
                    icon={<Files size={16} className="text-primary" />}
                    iconBg="bg-primary/10"
                    value={stats.totalFiles}
                    label="Total Files"
                    subtext="All uploaded files"
                    accent
                />
                <MetricCard
                    icon={<CheckCircle2 size={16} className="text-success" />}
                    iconBg="bg-success-bg"
                    value={stats.processed}
                    label="Processed"
                    subtext={`${stats.failed > 0 ? stats.failed + " failed" : "No failures"}`}
                />
                <MetricCard
                    icon={<Users size={16} className="text-info" />}
                    iconBg="bg-info-bg"
                    value={stats.totalUsers}
                    label="Users"
                    subtext="Admin + Standard"
                />
                <MetricCard
                    icon={<ShieldAlert size={16} className="text-danger" />}
                    iconBg="bg-danger-bg"
                    value={stats.totalPiiFound}
                    label="PII Entities"
                    subtext="Detected across all files"
                />
            </div>

            {/* ── Security + AI status ────────────────────────────────── */}
            <div className="mb-8 grid gap-4 lg:grid-cols-2">
                <SecurityStatusCard initial={encRes} />
                <AIModelStatusCard />
            </div>

            {/* ── Analytics Charts ────────────────────────────────────── */}
            <AnalyticsSection />

            {/* ── Recent Uploads ──────────────────────────────────────── */}
            <Card className="mt-8 border border-border bg-card shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between border-b border-border px-6 py-4">
                    <div>
                        <CardTitle className="font-display text-base font-semibold text-foreground">
                            Recent Uploads
                        </CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">Latest processed files</p>
                    </div>
                    <Link
                        href="/admin/files"
                        className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                    >
                        View all files →
                    </Link>
                </CardHeader>

                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                                {["File", "Type", "Uploaded By", "Status", "PII Found", "Date", ""].map((h) => (
                                    <TableHead
                                        key={h}
                                        className="px-5 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground"
                                    >
                                        {h}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {recentFiles.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="py-12 text-center">
                                        <Files size={32} className="mx-auto mb-3 text-muted-foreground/30" />
                                        <p className="text-sm font-medium text-muted-foreground">No files yet</p>
                                        <p className="mt-0.5 text-xs text-muted-foreground/70">Upload your first file to get started</p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                recentFiles.map((file) => (
                                    <TableRow
                                        key={file.id}
                                        className="border-border transition-colors duration-100 hover:bg-muted/40"
                                    >
                                        <TableCell className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <FileTypeIcon type={file.fileType} />
                                                <span
                                                    className="max-w-44 truncate text-sm font-medium text-foreground"
                                                    title={file.originalName}
                                                >
                                                    {file.originalName}
                                                </span>
                                            </div>
                                        </TableCell>

                                        <TableCell className="px-5">
                                            <Badge
                                                variant="secondary"
                                                className="rounded-md text-[0.6rem] uppercase tracking-wider font-semibold bg-muted text-muted-foreground border-0 px-1.5 py-0.5"
                                            >
                                                {file.fileType}
                                            </Badge>
                                        </TableCell>

                                        <TableCell className="px-5">
                                            <span
                                                className="max-w-36 truncate block font-code text-xs text-muted-foreground"
                                                title={file.uploader.email}
                                            >
                                                {file.uploader.email}
                                            </span>
                                        </TableCell>

                                        <TableCell className="px-5">
                                            <StatusBadge status={file.status} />
                                        </TableCell>

                                        <TableCell className="px-5">
                                            <span
                                                className={`font-display text-sm font-bold tabular-nums ${
                                                    file.totalPiiFound > 0
                                                        ? "text-danger"
                                                        : "text-muted-foreground"
                                                }`}
                                            >
                                                {file.totalPiiFound > 0
                                                    ? file.totalPiiFound.toLocaleString()
                                                    : "—"}
                                            </span>
                                        </TableCell>

                                        <TableCell className="px-5">
                                            <span className="font-code text-xs text-muted-foreground">
                                                {formatDate(file.uploadedAt)}
                                            </span>
                                        </TableCell>

                                        <TableCell className="px-5">
                                            <Link
                                                href={`/admin/files/${file.id}`}
                                                className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                                            >
                                                View →
                                            </Link>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </Card>
        </div>
    );
}
