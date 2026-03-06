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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────

type MaskingMode = "redact" | "mask" | "tokenize";
type UploadState = "idle" | "uploading" | "processing" | "done" | "error";
type ServiceStatus = "checking" | "ready" | "no-indic-bert" | "unavailable";

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_FORMATS = ["SQL", "PDF", "DOCX", "CSV", "TXT", "JSON", "PNG", "JPG"];
const ACCEPT = ".pdf,.docx,.sql,.csv,.txt,.json,.png,.jpg,.jpeg";
const LARGE_FILE_THRESHOLD_MB = 10;

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

function ProgressBar({ indeterminate = false }: { indeterminate?: boolean }) {
    return (
        <div className="h-1 w-64 overflow-hidden rounded-full bg-muted">
            {indeterminate ? (
                <div className="h-full w-1/3 animate-[progressIndeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            ) : (
                <div className="h-full w-full animate-[progressFill_1.2s_ease-out_forwards] rounded-full bg-primary" />
            )}
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
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const redirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isLargeFile = fileSizeMb > LARGE_FILE_THRESHOLD_MB;

    useEffect(() => {
        let cancelled = false;
        async function checkHealth() {
            try {
                const res = await fetch("/api/health");
                const data = await res.json();
                if (cancelled) return;
                if (!data.available || !data.model_loaded) {
                    setServiceStatus("unavailable");
                } else if (data.indic_bert_loaded === false) {
                    setServiceStatus("no-indic-bert");
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
    }, []);

    const handleFile = useCallback(
        async (file: File) => {
            if (pollRef.current) clearInterval(pollRef.current);
            setFilename(file.name);
            setFileSizeMb(file.size / 1024 / 1024);
            setUploadState("uploading");
            setErrorMsg("");

            const MAX_FILE_SIZE = 100 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                setErrorMsg(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 100 MB.`);
                setUploadState("error");
                return;
            }

            try {
                const formData = new FormData();
                formData.append("file", file);
                formData.append("mode", mode);
                const res = await fetch("/api/files", { method: "POST", body: formData });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    setErrorMsg((err as { error?: string }).error ?? "Upload failed.");
                    setUploadState("error");
                    return;
                }
                const { file: dbFile, warning } = await res.json();
                if (warning) setUploadWarning(warning);
                setUploadedFileId(dbFile.id);
                setChunkInfo(null);
                setUploadState("processing");
                pollRef.current = setInterval(async () => {
                    try {
                        const statusRes = await fetch(`/api/files/${dbFile.id}/status`);
                        if (!statusRes.ok) return;
                        const data = await statusRes.json();
                        if (data.status === "DONE") {
                            clearInterval(pollRef.current!);
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
                            }, 1500);
                        } else if (data.status === "FAILED") {
                            clearInterval(pollRef.current!);
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
        setUploadState("idle");
        setFilename("");
        setFileSizeMb(0);
        setPiiCount(0);
        setErrorMsg("");
        setUploadedFileId(null);
        setChunkInfo(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    function DropZoneContent() {
        if (uploadState === "uploading") {
            return (
                <div className="flex flex-col items-center gap-4">
                    <Loader2 size={36} className="animate-spin text-primary" />
                    <p className="text-sm font-medium text-foreground">
                        Uploading{" "}
                        <span className="font-semibold">
                            {filename}
                            {fileSizeMb > 0 && (
                                <span className="ml-1 font-normal text-muted-foreground">
                                    ({fileSizeMb.toFixed(1)} MB)
                                </span>
                            )}
                        </span>…
                    </p>
                    <ProgressBar />
                </div>
            );
        }

        if (uploadState === "processing") {
            if (isLargeFile) {
                return (
                    <div className="flex flex-col items-center gap-4">
                        <Layers size={36} className="animate-pulse text-primary" />
                        <div className="text-center">
                            <p className="text-sm font-semibold text-foreground">
                                Processing large file in parallel chunks…
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {fileSizeMb.toFixed(1)} MB — splitting into chunks for parallel PII detection
                            </p>
                            {chunkInfo && (
                                <p className="mt-1 text-xs font-semibold text-primary">
                                    Chunk {chunkInfo.completed} of {chunkInfo.total} complete
                                </p>
                            )}
                        </div>
                        <ProgressBar indeterminate />
                    </div>
                );
            }
            return (
                <div className="flex flex-col items-center gap-4">
                    <Loader2 size={36} className="animate-spin text-primary" />
                    <div className="text-center">
                        <p className="text-sm font-semibold text-foreground">Scanning for PII…</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">This may take a moment</p>
                    </div>
                    <ProgressBar indeterminate />
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
                        <p className="mt-1 text-xs text-muted-foreground">Redirecting to file details…</p>
                    </div>
                    <div className="flex gap-3">
                        <Button asChild size="sm" className="bg-foreground text-background hover:bg-foreground/90">
                            <Link href={`/admin/files/${uploadedFileId}`}>View File Details →</Link>
                        </Button>
                        <Button variant="outline" size="sm" onClick={reset}>
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
                    <Button variant="outline" size="sm" onClick={reset}>
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
            </div>
        );
    }

    const isClickable = uploadState === "idle";

    return (
        <>
            <style>{`
        @keyframes progressFill {
          from { width: 0% }
          to   { width: 100% }
        }
        @keyframes progressIndeterminate {
          0%   { transform: translateX(-200%) }
          100% { transform: translateX(400%) }
        }
      `}</style>

            <div className="min-h-full p-6 lg:p-8">
                {/* Page header */}
                <div className="mb-8">
                    <h1 className="text-xl font-bold text-foreground tracking-tight">
                        Upload File for Sanitization
                    </h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        Supported formats: SQL, PDF, DOCX, CSV, TXT, JSON, PNG, JPG
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
                {serviceStatus === "no-indic-bert" && (
                    <StatusBanner icon={<Info size={13} />} variant="info">
                        <span>
                            Running in <strong>spaCy + regex mode</strong> — transformer NER (indic-bert) is not loaded.
                            All PII types including Aadhaar, PAN, and phone numbers are still detected normally.
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
                                    <DropZoneContent />
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
