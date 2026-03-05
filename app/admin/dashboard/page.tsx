import Link from "next/link";
import {
    Files,
    CheckCircle,
    Users,
    ShieldAlert,
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

// ── Types ─────────────────────────────────────────────────────────────────────

type FileStatus = "PROCESSING" | "DONE" | "FAILED";

interface MockFile {
    id: string;
    originalName: string;
    fileType: string;
    status: FileStatus;
    totalPiiFound: number;
    uploadedAt: string; // ISO string
    user: { email: string };
}

// ── Mock data ─────────────────────────────────────────────────────────────────
// TODO: replace with real data from Prisma

const STATS = {
    totalFiles: 24,
    processed: 18,
    failed: 2,
    totalUsers: 5,
    totalPiiFound: 342,
};

const RECENT_FILES: MockFile[] = [
    {
        id: "clx001",
        originalName: "employee_records.pdf",
        fileType: "pdf",
        status: "DONE",
        totalPiiFound: 87,
        uploadedAt: "2026-03-05T10:14:00.000Z",
        user: { email: "admin@company.in" },
    },
    {
        id: "clx002",
        originalName: "customer_dump.sql",
        fileType: "sql",
        status: "DONE",
        totalPiiFound: 134,
        uploadedAt: "2026-03-05T09:02:00.000Z",
        user: { email: "admin@company.in" },
    },
    {
        id: "clx003",
        originalName: "onboarding_form.docx",
        fileType: "docx",
        status: "PROCESSING",
        totalPiiFound: 0,
        uploadedAt: "2026-03-05T13:50:00.000Z",
        user: { email: "rahul.sharma@company.in" },
    },
    {
        id: "clx004",
        originalName: "transactions_march.csv",
        fileType: "csv",
        status: "FAILED",
        totalPiiFound: 0,
        uploadedAt: "2026-03-04T17:30:00.000Z",
        user: { email: "priya.k@company.in" },
    },
    {
        id: "clx005",
        originalName: "aadhaar_scan.jpg",
        fileType: "jpg",
        status: "DONE",
        totalPiiFound: 42,
        uploadedAt: "2026-03-04T11:20:00.000Z",
        user: { email: "admin@company.in" },
    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
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
    const cls = "size-4 shrink-0";
    switch (type.toLowerCase()) {
        case "pdf":
            return <FileText className={`${cls} text-red-500`} />;
        case "sql":
            return <FileCode className={`${cls} text-violet-500`} />;
        case "docx":
            return <FileText className={`${cls} text-blue-500`} />;
        case "csv":
            return <FileSpreadsheet className={`${cls} text-green-600`} />;
        case "json":
            return <FileJson className={`${cls} text-yellow-500`} />;
        case "jpg":
        case "jpeg":
        case "png":
            return <Image className={`${cls} text-pink-500`} />;
        default:
            return <FileText className={`${cls} text-gray-400`} />;
    }
}

function StatusBadge({ status }: { status: FileStatus }) {
    if (status === "PROCESSING") {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                <Loader2 className="size-3 animate-spin" />
                Processing
            </span>
        );
    }
    if (status === "DONE") {
        return (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                Done
            </span>
        );
    }
    return (
        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
            Failed
        </span>
    );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
    icon: React.ReactNode;
    iconBg: string;
    value: number;
    label: string;
    subtext: string;
}

function StatCard({ icon, iconBg, value, label, subtext }: StatCardProps) {
    return (
        <Card className="border border-gray-100 shadow-sm">
            <CardContent className="flex items-start gap-4 pt-6">
                <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
                >
                    {icon}
                </div>
                <div>
                    <p className="text-2xl font-bold text-gray-900">{value.toLocaleString("en-IN")}</p>
                    <p className="text-sm font-medium text-gray-700">{label}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{subtext}</p>
                </div>
            </CardContent>
        </Card>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
    return (
        <div className="min-h-full p-6 lg:p-8">
            {/* Page header */}
            <div className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                    <p className="mt-0.5 text-sm text-gray-500">PII Sanitization Platform</p>
                </div>
                <p className="text-sm text-gray-400 sm:mt-1">{todayLabel()}</p>
            </div>

            {/* Stats grid */}
            <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                    icon={<Files size={20} className="text-blue-600" />}
                    iconBg="bg-blue-100"
                    value={STATS.totalFiles}
                    label="Total Files"
                    subtext="All uploaded files"
                />
                <StatCard
                    icon={<CheckCircle size={20} className="text-green-600" />}
                    iconBg="bg-green-100"
                    value={STATS.processed}
                    label="Successfully Processed"
                    subtext="PII sanitized"
                />
                <StatCard
                    icon={<Users size={20} className="text-purple-600" />}
                    iconBg="bg-purple-100"
                    value={STATS.totalUsers}
                    label="Registered Users"
                    subtext="Admin + Standard"
                />
                <StatCard
                    icon={<ShieldAlert size={20} className="text-red-600" />}
                    iconBg="bg-red-100"
                    value={STATS.totalPiiFound}
                    label="Total PII Detected"
                    subtext="Across all files"
                />
            </div>

            {/* Recent uploads table */}
            <Card className="border border-gray-100 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900">
                        Recent Uploads
                    </CardTitle>
                    <Link
                        href="/admin/files"
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >
                        View All →
                    </Link>
                </CardHeader>

                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-50 hover:bg-gray-50">
                                <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    File Name
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Type
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Uploaded By
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Status
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    PII Found
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Date
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Action
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {RECENT_FILES.map((file) => (
                                <TableRow
                                    key={file.id}
                                    className="hover:bg-gray-50/70 transition-colors"
                                >
                                    {/* File name */}
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <FileTypeIcon type={file.fileType} />
                                            <span
                                                className="max-w-[160px] truncate text-sm font-medium text-gray-800"
                                                title={file.originalName}
                                            >
                                                {file.originalName}
                                            </span>
                                        </div>
                                    </TableCell>

                                    {/* Type badge */}
                                    <TableCell>
                                        <Badge
                                            variant="secondary"
                                            className="rounded-sm bg-gray-100 text-[10px] uppercase tracking-wider text-gray-600 hover:bg-gray-100"
                                        >
                                            {file.fileType}
                                        </Badge>
                                    </TableCell>

                                    {/* Uploaded by */}
                                    <TableCell>
                                        <span
                                            className="max-w-[140px] truncate block text-sm text-gray-600"
                                            title={file.user.email}
                                        >
                                            {file.user.email}
                                        </span>
                                    </TableCell>

                                    {/* Status */}
                                    <TableCell>
                                        <StatusBadge status={file.status} />
                                    </TableCell>

                                    {/* PII count */}
                                    <TableCell>
                                        <span
                                            className={`text-sm font-semibold ${file.totalPiiFound > 0 ? "text-red-600" : "text-gray-400"
                                                }`}
                                        >
                                            {file.totalPiiFound > 0
                                                ? file.totalPiiFound.toLocaleString("en-IN")
                                                : "—"}
                                        </span>
                                    </TableCell>

                                    {/* Date */}
                                    <TableCell>
                                        <span className="text-xs text-gray-500">
                                            {formatDate(file.uploadedAt)}
                                        </span>
                                    </TableCell>

                                    {/* Action */}
                                    <TableCell>
                                        <Link
                                            href={`/admin/files/${file.id}`}
                                            className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
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
