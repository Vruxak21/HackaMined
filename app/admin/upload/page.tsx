"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    EyeOff,
    Eye,
    Key,
    Upload,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Shield,
    WifiOff,
    AlertTriangle,
    Info,
    Layers,
    Clock,
    RefreshCw,
    XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type MaskingMode = "redact" | "mask" | "tokenize";
type UploadState = "idle" | "uploading" | "processing" | "done" | "error";
type ServiceStatus = "checking" | "ready" | "loading" | "unavailable";

type PipelineConfigData = {
    use_bert: boolean;
    use_spacy: boolean;
    spacy_model: string;
    skip_bert_reason: string;
};

type ChunkProgressData = {
    progress: Record<string, string>;
    completed: number;
    total: number;
    percent: number;
    chunked: boolean;
    pipeline_config?: PipelineConfigData;
};

// ── Processing stage messages ───────────────────────────────────────────────────

const SMALL_FILE_STAGES = [
    "Extracting text content…",
    "Running regex pattern detection…",
    "Analyzing with NLP models…",
    "Cross-referencing identity anchors…",
    "Applying masking rules…",
    "Finalizing sanitized output…",
];

function ProcessingStageText() {
    const [idx, setIdx] = useState(0);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const tick = setInterval(() => {
            setVisible(false);
            setTimeout(() => {
                setIdx((i) => (i + 1) % SMALL_FILE_STAGES.length);
                setVisible(true);
            }, 300);
        }, 2800);
        return () => clearInterval(tick);
    }, []);

    return (
        <p
            className="mt-0.5 text-xs text-muted-foreground transition-opacity duration-300"
            style={{ opacity: visible ? 1 : 0 }}
        >
            {SMALL_FILE_STAGES[idx]}
        </p>
    );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_FORMATS = ["SQL", "PDF", "DOCX", "CSV", "TXT", "JSON", "PNG", "JPG"];
const ACCEPT = ".pdf,.docx,.sql,.csv,.txt,.json,.png,.jpg,.jpeg";
const MAX_FILE_SIZE = 52_428_800; // 50 MB
const MAX_FILE_SIZE_LABEL = "50MB";
const LARGE_FILE_THRESHOLD_MB = 5;

const MASKING_MODES: {
    id: MaskingMode;
    label: string;
    icon: React.ReactNode;
    example: string;
    description: string;
}[] = [
        {
            id: "redact",
            label: "Redact",
            icon: <EyeOff size={16} />,
            example: "[REDACTED]",
            description: "Complete removal of PII",
        },
        {
            id: "mask",
            label: "Mask",
            icon: <Eye size={16} />,
            example: "j***@email.com",
            description: "Partial masking, preserves format",
        },
        {
            id: "tokenize",
            label: "Tokenize",
            icon: <Key size={16} />,
            example: "<<NAME_001>>",
            description: "Replace with unique tokens",
        },
    ];

const PII_TYPES = [
    "Names (Indian)",
    "Aadhaar Number",
    "PAN Card",
    "Email Addresses",
    "Phone Numbers",
    "Physical Addresses",
    "Credit / Debit Cards",
    "CVV Numbers",
    "UPI IDs",
    "IFSC Codes",
    "Passport Numbers",
    "IP Addresses",
    "Date of Birth",
    "Bank Account Numbers",
    "Device IDs",
    "Biometric Strings",
];

// ── Chunk mini-cards ──────────────────────────────────────────────────────────

const CHUNK_CFG = {
    pending:    { label: "Pending",    icon: Clock,        cls: "border-gray-200 bg-gray-50 text-gray-400" },
    processing: { label: "Processing", icon: RefreshCw,    cls: "border-blue-200 bg-blue-50 text-blue-500" },
    done:       { label: "Done",       icon: CheckCircle2, cls: "border-green-200 bg-green-50 text-green-600" },
    failed:     { label: "Failed",     icon: XCircle,      cls: "border-red-200 bg-red-50 text-red-500" },
} as const;
type ChunkState = keyof typeof CHUNK_CFG;
function isChunkState(s: string): s is ChunkState { return s in CHUNK_CFG; }

function MiniChunkCard({ index, total, status }: { index: number; total: number; status: string }) {
    const key = isChunkState(status) ? status : "pending";
    const { label, icon: Icon, cls } = CHUNK_CFG[key];

    // Smooth fill: 0 → ~90% while processing (decelerating), then snap to 100%
    const [fillPct, setFillPct] = useState(0);
    const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
    const prevKey   = useRef(key);

    useEffect(() => {
        if (key === "processing" && prevKey.current !== "processing") {
            setFillPct(3);
            timerRef.current = setInterval(() => {
                setFillPct(p => {
                    const remaining = 90 - p;
                    return p + Math.max(0.1, remaining * 0.018); // decelerate toward 90%
                });
            }, 300);
        }
        if (key === "done" || key === "failed") {
            if (timerRef.current) clearInterval(timerRef.current);
            setFillPct(100);
        }
        if (key === "pending") {
            if (timerRef.current) clearInterval(timerRef.current);
            setFillPct(0);
        }
        prevKey.current = key;
    }, [key]);

    useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

    const barColor = key === "processing" ? "bg-blue-400"
        : key === "done"    ? "bg-green-500"
        : key === "failed"  ? "bg-red-400"
        : "bg-gray-300";

    return (
        <div className={cn("flex flex-col gap-1.5 rounded-md border p-2 transition-colors duration-300", cls)}>
            <div className="flex items-center justify-between gap-1">
                <span className="text-[0.65rem] font-semibold leading-none opacity-70">
                    Chunk {index + 1}/{total}
                </span>
                <Icon size={10} className={cn(key === "processing" && "animate-spin")} />
            </div>
            <span className="text-[0.6rem] font-medium">{label}</span>
            {/* smooth fill bar */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-black/10">
                <div
                    className={cn("h-full rounded-full transition-all duration-300", barColor)}
                    style={{ width: `${fillPct}%` }}
                />
            </div>
        </div>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeCard({
    mode,
    selected,
    onClick,
}: {
    mode: (typeof MASKING_MODES)[number];
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "flex flex-1 flex-col gap-3 rounded-lg border-2 p-4 text-left transition-all duration-150",
                selected
                    ? "border-primary bg-primary/6"
                    : "border-border bg-card hover:border-primary/40 hover:bg-primary/3",
            ].join(" ")}
        >
            <div
                className={[
                    "flex size-8 items-center justify-center rounded-md",
                    selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                ].join(" ")}
            >
                {mode.icon}
            </div>

            <div className="w-full">
                <p className={`text-sm font-semibold ${selected ? "text-foreground" : "text-foreground"}`}>
                    {mode.label}
                </p>
                <code
                    className={`mt-1.5 block w-full rounded px-2 py-1 font-mono text-xs border ${selected
                            ? "bg-primary/8 text-foreground border-primary/20"
                            : "bg-muted text-muted-foreground border-border"
                        }`}
                >
                    {mode.example}
                </code>
                <p className="mt-2 text-[0.7rem] text-muted-foreground">{mode.description}</p>
            </div>
        </button>
    );
}

function ProgressBar({ value }: { value: number }) {
    const pct = Math.min(100, Math.max(0, value));
    return (
        <div className="flex w-64 flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className="tabular-nums font-semibold text-foreground">{Math.round(pct)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${pct}%`, transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)' }}
                />
            </div>
        </div>
    );
}

// ── Status Banner ─────────────────────────────────────────────────────────────

function StatusBanner({
    icon,
    variant,
    children,
}: {
    icon: React.ReactNode;
    variant: "neutral" | "error" | "info" | "warning";
    children: React.ReactNode;
}) {
    const colors = {
        neutral: "border-border bg-muted text-muted-foreground",
        error: "border-destructive/20 bg-destructive/6 text-destructive",
        info: "border-primary/20 bg-primary/6 text-foreground",
        warning: "border-amber-200 bg-amber-50 text-amber-800",
    };
    return (
        <div className={`mb-5 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${colors[variant]}`}>
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span>{children}</span>
        </div>
    );
}
// ── Pipeline Mode Badge ──────────────────────────────────────────────────────

function PipelineModeBadge({ config }: { config?: PipelineConfigData }) {
    if (!config) return null;

    let label: string;
    let subtitle: string;
    let cls: string;

    if (config.use_bert) {
        label = "Full AI Pipeline";
        subtitle = "Regex + spaCy + BERT — maximum accuracy";
        cls = "border-teal-200 bg-teal-50 text-teal-700";
    } else if (config.use_spacy) {
        label = "Fast Mode";
        subtitle = "Regex + spaCy — optimized for large files";
        cls = "border-blue-200 bg-blue-50 text-blue-700";
    } else {
        label = "Structured Mode";
        subtitle = "Regex only — structured data detected";
        cls = "border-amber-200 bg-amber-50 text-amber-700";
    }

    return (
        <div className={cn("mt-1 inline-flex flex-col rounded-md border px-3 py-1.5 text-xs", cls)}>
            <span className="font-semibold">{label}</span>
            <span className="opacity-75">{subtitle}</span>
        </div>
    );
}

// ── Time Estimate Helper ─────────────────────────────────────────────────────

function formatTimeRemaining(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `~${seconds} seconds remaining`;
    const minutes = Math.round(seconds / 60);
    return `~${minutes} minute${minutes !== 1 ? "s" : ""} remaining`;
}

// ── Drop Zone Content (top-level to prevent animation resets on re-render) ──

type DropZoneContentProps = {
    uploadState: UploadState;
    filename: string;
    fileSizeMb: number;
    progress: number;
    piiCount: number;
    errorMsg: string;
    uploadedFileId: string | null;
    chunkInfo: { total: number; completed: number } | null;
    chunkProgress: ChunkProgressData | null;
    pipelineConfig: PipelineConfigData | undefined;
    processingStartTime: number | null;
    isLargeFile: boolean;
    isDragging: boolean;
    onReset: () => void;
};

function DropZoneContent({
    uploadState,
    filename,
    fileSizeMb,
    progress,
    piiCount,
    errorMsg,
    uploadedFileId,
    chunkInfo,
    chunkProgress,
    pipelineConfig,
    processingStartTime,
    isLargeFile,
    isDragging,
    onReset,
}: DropZoneContentProps) {
    if (uploadState === "uploading") {
        const waitingForServer = progress >= 100;
        return (
            <div className="flex flex-col items-center gap-4">
                <Loader2 size={36} className="animate-spin text-primary" />
                {waitingForServer ? (
                    <div className="text-center">
                        <p className="text-sm font-semibold text-foreground">Preparing for analysis…</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            File received — setting up processing pipeline
                        </p>
                    </div>
                ) : (
                    <div className="text-center">
                        <p className="text-sm font-medium text-foreground">
                            Uploading{" "}
                            <span className="font-semibold">
                                {filename}
                                {fileSizeMb > 0 && (
                                    <span className="ml-1 font-normal text-muted-foreground">
                                        ({fileSizeMb.toFixed(1)} MB)
                                    </span>
                                )}
                            </span>
                        </p>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            {progress}% uploaded
                        </p>
                    </div>
                )}
                {waitingForServer ? (
                    <div className="flex w-64 flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Preparing</span>
                            <span className="text-[0.65rem] text-muted-foreground">Please wait…</span>
                        </div>
                        <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                                className="absolute h-full w-1/3 rounded-full bg-primary"
                                style={{ animation: "progress-indeterminate 1.4s ease-in-out infinite" }}
                            />
                        </div>
                    </div>
                ) : (
                    <ProgressBar value={progress} />
                )}
            </div>
        );
    }

    if (uploadState === "processing") {
        if (isLargeFile) {
            const liveTotal = chunkProgress?.total ?? 0;
            const liveCompleted = chunkProgress?.completed ?? 0;
            const processingCount = Object.values(chunkProgress?.progress ?? {}).filter(s => s === "processing").length;
            // Weight: done=100%, processing=50%, pending=0% — gives smooth 0→100 movement
            const liveProgress = chunkProgress && chunkProgress.total > 0
                ? Math.round((liveCompleted * 100 + processingCount * 50) / chunkProgress.total)
                : progress;

            // Time estimate
            let timeEstimate: string | null = null;
            if (processingStartTime && liveCompleted > 0 && liveCompleted < liveTotal) {
                const elapsed = Date.now() - processingStartTime;
                const rate = liveCompleted / elapsed;
                const remaining = (liveTotal - liveCompleted) / rate;
                timeEstimate = formatTimeRemaining(remaining);
            }

            return (
                <div className="flex w-full flex-col items-center gap-4">
                    <Layers size={36} className="animate-pulse text-primary" />
                    <div className="text-center">
                        <p className="text-sm font-semibold text-foreground">
                            Processing large file in parallel chunks…
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {fileSizeMb.toFixed(1)} MB — splitting into chunks for parallel PII detection
                        </p>
                        <PipelineModeBadge config={pipelineConfig} />
                        {liveTotal > 0 && (
                            <p className="mt-1 text-xs font-semibold text-primary">
                                {liveCompleted} of {liveTotal} chunk{liveTotal !== 1 ? "s" : ""} complete
                            </p>
                        )}
                        {timeEstimate && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{timeEstimate}</p>
                        )}
                    </div>
                    <ProgressBar value={liveProgress} />
                    {/* Live chunk cards */}
                    {liveTotal > 0 && (
                        <div className="grid w-full grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
                            {Array.from({ length: liveTotal }, (_, i) => {
                                const st = chunkProgress?.progress[String(i)] ?? "pending";
                                return <MiniChunkCard key={i} index={i} total={liveTotal} status={st} />;
                            })}
                        </div>
                    )}
                    {liveTotal === 0 && (
                        <p className="text-xs text-muted-foreground animate-pulse">
                            Splitting file into chunks…
                        </p>
                    )}
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center gap-4">
                <Loader2 size={36} className="animate-spin text-primary" />
                <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">Scanning for PII…</p>
                    <ProcessingStageText />
                    <PipelineModeBadge config={pipelineConfig} />
                </div>
                <ProgressBar value={progress} />
            </div>
        );
    }

    if (uploadState === "done") {
        return (
            <div className="flex flex-col items-center gap-4">
                <CheckCircle2 size={36} className="text-primary" />
                <div className="text-center">
                    <p className="text-sm font-bold text-foreground">Sanitization Complete</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Found{" "}
                        <span className="font-semibold text-destructive">
                            {piiCount} PII instance{piiCount !== 1 ? "s" : ""}
                        </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Redirecting to files list…</p>
                </div>
                <div className="flex gap-3">
                    <Button asChild size="sm" className="bg-foreground text-background hover:bg-foreground/90">
                        <Link href={`/admin/files/${uploadedFileId}`}>View File Details →</Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={onReset}>
                        Upload Another
                    </Button>
                </div>
            </div>
        );
    }

    if (uploadState === "error") {
        return (
            <div className="flex flex-col items-center gap-4">
                <AlertCircle size={36} className="text-destructive" />
                <div className="text-center">
                    <p className="text-sm font-bold text-foreground">Upload Failed</p>
                    <p className="mt-1 text-sm text-muted-foreground">{errorMsg}</p>
                </div>
                <Button variant="outline" size="sm" onClick={onReset}>
                    Try Again
                </Button>
            </div>
        );
    }

    // idle
    return (
        <div className="flex flex-col items-center gap-4">
            <div
                className={[
                    "flex size-14 items-center justify-center rounded-xl border-2 transition-colors",
                    isDragging ? "border-primary bg-primary/8" : "border-border bg-muted",
                ].join(" ")}
            >
                <Upload
                    size={24}
                    className={isDragging ? "text-primary" : "text-muted-foreground"}
                />
            </div>
            <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Drop your file here</p>
                <p className="mt-0.5 text-xs text-muted-foreground">or click to browse</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
                {SUPPORTED_FORMATS.map((fmt) => (
                    <Badge
                        key={fmt}
                        variant="secondary"
                        className="rounded bg-muted text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted border-0"
                    >
                        {fmt}
                    </Badge>
                ))}
            </div>
            <p className="text-[0.65rem] text-muted-foreground">
                Maximum file size: {MAX_FILE_SIZE_LABEL}
            </p>
        </div>
    );
}
// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminUploadPage() {
    const router = useRouter();
    const [mode, setMode] = useState<MaskingMode>("redact");
    const [uploadState, setUploadState] = useState<UploadState>("idle");
    const [isDragging, setIsDragging] = useState(false);
    const [filename, setFilename] = useState("");
    const [fileSizeMb, setFileSizeMb] = useState(0);
    const [piiCount, setPiiCount] = useState(0);
    const [errorMsg, setErrorMsg] = useState("");
    const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
    const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("checking");
    const [uploadWarning, setUploadWarning] = useState<string | null>(null);
    const [chunkInfo, setChunkInfo] = useState<{ total: number; completed: number } | null>(null);
    const [chunkProgress, setChunkProgress] = useState<ChunkProgressData | null>(null);
    const [pipelineConfig, setPipelineConfig] = useState<PipelineConfigData | undefined>();
    const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
    const [progress, setProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const redirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const chunkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const isLargeFile = fileSizeMb > LARGE_FILE_THRESHOLD_MB;

    useEffect(() => {
        let cancelled = false;
        async function checkHealth() {
            try {
                const res = await fetch("/api/health");
                const data = await res.json();
                if (cancelled) return;
                if (!data.available) {
                    setServiceStatus("unavailable");
                } else if (data.status === "loading") {
                    setServiceStatus("loading");
                } else {
                    setServiceStatus("ready");
                }
            } catch {
                if (!cancelled) setServiceStatus("unavailable");
            }
        }
        checkHealth();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => () => {
        if (pollRef.current) clearInterval(pollRef.current);
        if (redirectRef.current) clearTimeout(redirectRef.current);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        if (chunkPollRef.current) clearInterval(chunkPollRef.current);
    }, []);

    const handleFile = useCallback(
        async (file: File) => {
            if (pollRef.current) clearInterval(pollRef.current);
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            if (chunkPollRef.current) clearInterval(chunkPollRef.current);
            setFilename(file.name);
            setFileSizeMb(file.size / 1024 / 1024);
            setUploadState("uploading");
            setErrorMsg("");
            setProgress(0);
            setPipelineConfig(undefined);
            setProcessingStartTime(null);

            if (file.size > MAX_FILE_SIZE) {
                setErrorMsg(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_FILE_SIZE_LABEL}.`);
                setUploadState("error");
                return;
            }

            try {
                const formData = new FormData();
                formData.append("file", file);
                formData.append("mode", mode);

                // Use XHR to receive real upload progress events
                type XHRResult = { ok: boolean; text: string };
                const { ok, text } = await new Promise<XHRResult>((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            setProgress(Math.round((e.loaded / e.total) * 100));
                        }
                    };
                    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, text: xhr.responseText });
                    xhr.onerror = () => reject(new Error("Network error"));
                    xhr.open("POST", "/api/files");
                    xhr.send(formData);
                });

                if (!ok) {
                    const err = (() => { try { return JSON.parse(text); } catch { return {}; } })();
                    setErrorMsg((err as { error?: string }).error ?? "Upload failed.");
                    setUploadState("error");
                    return;
                }
                const { file: dbFile, warning } = JSON.parse(text) as { file: { id: string }; warning?: string };
                if (warning) setUploadWarning(warning);
                setUploadedFileId(dbFile.id);
                setChunkInfo(null);
                setChunkProgress(null);
                setUploadState("processing");
                setProcessingStartTime(Date.now());

                // If large file: start chunk progress polling
                if (file.size > LARGE_FILE_THRESHOLD_MB * 1024 * 1024) {
                    chunkPollRef.current = setInterval(async () => {
                        try {
                            const cRes = await fetch(`/api/files/${dbFile.id}/chunks`, { cache: "no-store" });
                            if (cRes.ok) {
                                const cData = await cRes.json() as ChunkProgressData;
                                if (cData.chunked && cData.total > 0) {
                                    setChunkProgress(cData);
                                }
                                // Capture pipeline_config if returned
                                if (cData.pipeline_config) {
                                    setPipelineConfig(cData.pipeline_config);
                                }
                            }
                        } catch { /* keep polling */ }
                    }, 1_000);
                }

                // Smooth easing simulation: ticks every 100ms with a tiny
                // decelerating step toward 95%. The 600ms CSS transition
                // bridges consecutive updates so the bar moves continuously.
                setProgress(0);
                progressIntervalRef.current = setInterval(() => {
                    setProgress((prev) => {
                        if (prev >= 95) return prev;
                        const remaining = 95 - prev;
                        return prev + Math.max(0.3, remaining * 0.04);
                    });
                }, 100);

                pollRef.current = setInterval(async () => {
                    try {
                        const statusRes = await fetch(`/api/files/${dbFile.id}/status`, { cache: "no-store" });
                        if (!statusRes.ok) return;
                        const data = await statusRes.json();
                        if (data.status === "DONE") {
                            clearInterval(pollRef.current!);
                            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
                            if (chunkPollRef.current) clearInterval(chunkPollRef.current);
                            // Final chunk fetch: file is now DONE so the /chunks endpoint reads
                            // persisted chunk_statuses from DB and flips all cards to "done".
                            try {
                                const cRes = await fetch(`/api/files/${dbFile.id}/chunks`, { cache: "no-store" });
                                if (cRes.ok) {
                                    const cData = await cRes.json() as ChunkProgressData;
                                    if (cData.chunked && cData.total > 0) setChunkProgress(cData);
                                }
                            } catch { /* non-critical */ }
                            // Animate bar to 100% first, then reveal the done state
                            // after the 600ms CSS transition completes.
                            setProgress(100);
                            redirectRef.current = setTimeout(() => {
                                setPiiCount(data.totalPiiFound ?? 0);
                                if (data.processingInfo?.chunked_processing) {
                                    setChunkInfo({
                                        total: data.processingInfo.total_chunks ?? 0,
                                        completed: data.processingInfo.completed_chunks ?? 0,
                                    });
                                }
                                setUploadState("done");
                                redirectRef.current = setTimeout(() => {
                                    router.push(`/admin/files/${dbFile.id}`);
                                }, 2000);
                            }, 700); // wait for bar transition before showing done
                        } else if (data.status === "FAILED") {
                            clearInterval(pollRef.current!);
                            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
                            if (chunkPollRef.current) clearInterval(chunkPollRef.current);
                            setErrorMsg("Processing failed. Please try again.");
                            setUploadState("error");
                        }
                    } catch { /* keep polling */ }
                }, 1500);
            } catch {
                setErrorMsg("Upload failed. Please check your connection.");
                setUploadState("error");
            }
        },
        [mode]
    );

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    };

    const reset = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        if (redirectRef.current) clearTimeout(redirectRef.current);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        if (chunkPollRef.current) clearInterval(chunkPollRef.current);
        setUploadState("idle");
        setFilename("");
        setFileSizeMb(0);
        setPiiCount(0);
        setErrorMsg("");
        setProgress(0);
        setUploadedFileId(null);
        setChunkInfo(null);
        setChunkProgress(null);
        setPipelineConfig(undefined);
        setProcessingStartTime(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const isClickable = uploadState === "idle";

    return (
        <>


            <div className="min-h-full p-6 lg:p-8">
                {/* Page header */}
                <div className="mb-8">
                    <h1 className="text-xl font-bold text-foreground tracking-tight">
                        Upload File for Sanitization
                    </h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        Supported formats: SQL, PDF, DOCX, CSV, TXT, JSON, PNG, JPG &middot; Maximum file size: {MAX_FILE_SIZE_LABEL}
                    </p>
                </div>

                {/* Service status banners */}
                {serviceStatus === "checking" && (
                    <StatusBanner icon={<Loader2 size={13} className="animate-spin" />} variant="neutral">
                        Checking PII detection service…
                    </StatusBanner>
                )}
                {serviceStatus === "unavailable" && (
                    <StatusBanner icon={<WifiOff size={13} />} variant="error">
                        <span>
                            <strong>Python service is not running.</strong> Uploads will fail until the service is started.
                            Run: <code className="rounded bg-destructive/10 px-1 py-0.5 text-xs">python -m uvicorn main:app --host 0.0.0.0 --port 8000</code> in the <code className="rounded bg-destructive/10 px-1 py-0.5 text-xs">python-service/</code> directory.
                        </span>
                    </StatusBanner>
                )}
                {serviceStatus === "loading" && (
                    <StatusBanner icon={<Loader2 size={13} className="animate-spin" />} variant="warning">
                        <span>
                            <strong>AI models are loading…</strong> Large file uploads will be slower until loading completes.
                        </span>
                    </StatusBanner>
                )}
                {uploadWarning && (
                    <StatusBanner icon={<AlertTriangle size={13} />} variant="warning">
                        {uploadWarning}
                    </StatusBanner>
                )}

                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left column */}
                    <div className="flex flex-col gap-6 lg:col-span-2">
                        {/* Masking Mode */}
                        <Card className="border border-border shadow-none">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-sm font-semibold text-foreground">
                                    Select Masking Mode
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-col gap-3 sm:flex-row">
                                    {MASKING_MODES.map((m) => (
                                        <ModeCard
                                            key={m.id}
                                            mode={m}
                                            selected={mode === m.id}
                                            onClick={() => setMode(m.id)}
                                        />
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Drop zone */}
                        <Card className="border border-border shadow-none">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-sm font-semibold text-foreground">
                                    Upload File
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div
                                    role={isClickable ? "button" : undefined}
                                    tabIndex={isClickable ? 0 : undefined}
                                    aria-label={isClickable ? "Click or drag to upload a file" : undefined}
                                    onClick={() => isClickable && fileInputRef.current?.click()}
                                    onKeyDown={(e) => {
                                        if (isClickable && (e.key === "Enter" || e.key === " ")) {
                                            fileInputRef.current?.click();
                                        }
                                    }}
                                    onDragOver={isClickable ? onDragOver : undefined}
                                    onDragLeave={isClickable ? onDragLeave : undefined}
                                    onDrop={isClickable ? onDrop : undefined}
                                    className={[
                                        "flex min-h-52 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-all duration-200",
                                        isClickable
                                            ? isDragging
                                                ? "border-primary bg-primary/6 cursor-copy"
                                                : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/3 cursor-pointer"
                                            : "border-border bg-muted/30 cursor-default",
                                    ].join(" ")}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept={ACCEPT}
                                        className="sr-only"
                                        onChange={handleInputChange}
                                        tabIndex={-1}
                                    />
                                    <DropZoneContent
                                        uploadState={uploadState}
                                        filename={filename}
                                        fileSizeMb={fileSizeMb}
                                        progress={progress}
                                        piiCount={piiCount}
                                        errorMsg={errorMsg}
                                        uploadedFileId={uploadedFileId}
                                        chunkInfo={chunkInfo}
                                        chunkProgress={chunkProgress}
                                        pipelineConfig={pipelineConfig}
                                        processingStartTime={processingStartTime}
                                        isLargeFile={isLargeFile}
                                        isDragging={isDragging}
                                        onReset={reset}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right column — PII types */}
                    <div>
                        <Card className="border border-border shadow-none">
                            <CardHeader className="pb-4">
                                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <Shield size={14} className="text-primary" />
                                    PII Types Detected
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {PII_TYPES.map((type) => (
                                        <li key={type} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                                            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                                            {type}
                                        </li>
                                    ))}
                                </ul>

                                <div className="mt-6 rounded-lg border border-border bg-muted/50 p-3">
                                    <p className="text-xs font-semibold text-foreground">Context-Aware Detection</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Numbers are only flagged as PII when linked to an identity (e.g., name + Aadhaar
                                        within the same context window).
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </>
    );
}
