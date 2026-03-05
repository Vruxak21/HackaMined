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
    CheckCircle,
    AlertCircle,
    Shield,
    WifiOff,
    AlertTriangle,
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

const MASKING_MODES: {
    id: MaskingMode;
    label: string;
    icon: React.ReactNode;
    example: string;
    exampleColor: string;
    description: string;
}[] = [
        {
            id: "redact",
            label: "Redact",
            icon: <EyeOff size={20} />,
            example: "[REDACTED]",
            exampleColor: "bg-red-50 text-red-700 border border-red-200",
            description: "Complete removal of PII",
        },
        {
            id: "mask",
            label: "Mask",
            icon: <Eye size={20} />,
            example: "j***@email.com",
            exampleColor: "bg-yellow-50 text-yellow-800 border border-yellow-200",
            description: "Partial masking, preserves format",
        },
        {
            id: "tokenize",
            label: "Tokenize",
            icon: <Key size={20} />,
            example: "<<NAME_001>>",
            exampleColor: "bg-blue-50 text-blue-700 border border-blue-200",
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
                "flex flex-1 flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all duration-150",
                selected
                    ? "border-blue-500 bg-blue-50 shadow-sm"
                    : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40",
            ].join(" ")}
        >
            <div
                className={[
                    "flex size-9 items-center justify-center rounded-lg",
                    selected ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600",
                ].join(" ")}
            >
                {mode.icon}
            </div>

            <div className="w-full">
                <p className={`font-semibold ${selected ? "text-blue-800" : "text-gray-800"}`}>
                    {mode.label}
                </p>
                <code
                    className={`mt-1.5 block w-full rounded px-2 py-1 font-mono text-xs ${mode.exampleColor}`}
                >
                    {mode.example}
                </code>
                <p className="mt-2 text-xs text-gray-500">{mode.description}</p>
            </div>
        </button>
    );
}

function ProgressBar({ indeterminate = false }: { indeterminate?: boolean }) {
    return (
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-gray-200">
            {indeterminate ? (
                <div className="h-full w-1/3 animate-[progressIndeterminate_1.4s_ease-in-out_infinite] rounded-full bg-purple-500" />
            ) : (
                <div className="h-full w-full animate-[progressFill_1.2s_ease-out_forwards] rounded-full bg-blue-500" />
            )}
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
    const [piiCount, setPiiCount] = useState(0);
    const [errorMsg, setErrorMsg] = useState("");
    const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
    const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("checking");
    const [uploadWarning, setUploadWarning] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const redirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Service health check ──────────────────────────────────────────────────
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

    // Cleanup poll and redirect timer on unmount
    useEffect(() => () => {
        if (pollRef.current) clearInterval(pollRef.current);
        if (redirectRef.current) clearTimeout(redirectRef.current);
    }, []);

    // ── Upload flow ───────────────────────────────────────────────────────────

    const handleFile = useCallback(
        async (file: File) => {
            if (pollRef.current) clearInterval(pollRef.current);
            setFilename(file.name);
            setUploadState("uploading");
            setErrorMsg("");
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
                setUploadState("processing");
                pollRef.current = setInterval(async () => {
                    try {
                        const statusRes = await fetch(`/api/files/${dbFile.id}/status`);
                        if (!statusRes.ok) return;
                        const data = await statusRes.json();
                        if (data.status === "DONE") {
                            clearInterval(pollRef.current!);
                            setPiiCount(data.totalPiiFound ?? 0);
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

    // Drag events
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
        setPiiCount(0);
        setErrorMsg("");
        setUploadedFileId(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // ── Drop zone content ─────────────────────────────────────────────────────

    function DropZoneContent() {
        if (uploadState === "uploading") {
            return (
                <div className="flex flex-col items-center gap-4">
                    <Loader2 size={44} className="animate-spin text-blue-500" />
                    <p className="text-sm font-medium text-gray-700">
                        Uploading <span className="font-semibold text-gray-900">{filename}</span>…
                    </p>
                    <ProgressBar />
                </div>
            );
        }

        if (uploadState === "processing") {
            return (
                <div className="flex flex-col items-center gap-4">
                    <Loader2 size={44} className="animate-spin text-purple-500" />
                    <div className="text-center">
                        <p className="text-sm font-semibold text-gray-800">Scanning for PII…</p>
                        <p className="mt-0.5 text-xs text-gray-400">This may take a moment</p>
                    </div>
                    <ProgressBar indeterminate />
                </div>
            );
        }

        if (uploadState === "done") {
            return (
                <div className="flex flex-col items-center gap-4">
                    <CheckCircle size={44} className="text-green-500" />
                    <div className="text-center">
                        <p className="text-base font-bold text-green-700">Sanitization Complete!</p>
                        <p className="mt-1 text-sm text-gray-500">
                            Found{" "}
                            <span className="font-semibold text-red-600">
                                {piiCount} PII instance{piiCount !== 1 ? "s" : ""}
                            </span>
                        </p>
                        <p className="mt-1 text-xs text-gray-400">Redirecting to file details…</p>
                    </div>
                    <div className="flex gap-3">
                        <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
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
                    <AlertCircle size={44} className="text-red-500" />
                    <div className="text-center">
                        <p className="text-base font-bold text-red-700">Upload Failed</p>
                        <p className="mt-1 text-sm text-gray-500">{errorMsg}</p>
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
                        "flex size-16 items-center justify-center rounded-2xl transition-colors",
                        isDragging ? "bg-blue-100" : "bg-gray-100",
                    ].join(" ")}
                >
                    <Upload
                        size={28}
                        className={isDragging ? "text-blue-600" : "text-gray-400"}
                    />
                </div>
                <div className="text-center">
                    <p className="text-sm font-semibold text-gray-800">Drop your file here</p>
                    <p className="mt-0.5 text-xs text-gray-400">or click to browse</p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                    {SUPPORTED_FORMATS.map((fmt) => (
                        <Badge
                            key={fmt}
                            variant="secondary"
                            className="rounded bg-gray-100 text-[10px] font-medium uppercase tracking-wide text-gray-500 hover:bg-gray-100"
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
            {/* Keyframe styles injected inline for progress animations */}
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
                    <h1 className="text-2xl font-bold text-gray-900">
                        Upload File for Sanitization
                    </h1>
                    <p className="mt-0.5 text-sm text-gray-500">
                        Supported formats: SQL, PDF, DOCX, CSV, TXT, JSON, PNG, JPG
                    </p>
                </div>

                {/* Service status banners */}
                {serviceStatus === "checking" && (
                    <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        <Loader2 size={15} className="animate-spin shrink-0" />
                        Checking PII detection service…
                    </div>
                )}
                {serviceStatus === "unavailable" && (
                    <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        <WifiOff size={15} className="mt-0.5 shrink-0" />
                        <span>
                            <strong>Python service is not running.</strong> Uploads will fail until the service is started.
                            Run: <code className="rounded bg-red-100 px-1 py-0.5 text-xs">python -m uvicorn main:app --host 0.0.0.0 --port 8000</code> in the <code className="rounded bg-red-100 px-1 py-0.5 text-xs">python-service/</code> directory.
                        </span>
                    </div>
                )}
                {serviceStatus === "no-indic-bert" && (
                    <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        <span>
                            <strong>indic-bert model not loaded</strong> — running in spaCy-only mode.
                            Indian PII (Aadhaar, PAN, phone) is still detected via the regex layer. Only transformer-based NER is unavailable.
                        </span>
                    </div>
                )}
                {uploadWarning && (
                    <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        {uploadWarning}
                    </div>
                )}

                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left column — mode + drop zone */}
                    <div className="flex flex-col gap-6 lg:col-span-2">
                        {/* Masking Mode card */}
                        <Card className="border border-gray-100 shadow-sm">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base font-semibold text-gray-900">
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

                        {/* Drop zone card */}
                        <Card className="border border-gray-100 shadow-sm">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base font-semibold text-gray-900">
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
                                        "flex min-h-56 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-all duration-200",
                                        isClickable
                                            ? isDragging
                                                ? "border-blue-400 bg-blue-50 cursor-copy"
                                                : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/40 cursor-pointer"
                                            : "border-gray-200 bg-gray-50 cursor-default",
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

                    {/* Right column — guidelines */}
                    <div>
                        <Card className="border border-gray-100 shadow-sm">
                            <CardHeader className="pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
                                    <Shield size={16} className="text-blue-600" />
                                    PII Types Detected
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {PII_TYPES.map((type) => (
                                        <li key={type} className="flex items-center gap-2 text-sm text-gray-600">
                                            <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
                                            {type}
                                        </li>
                                    ))}
                                </ul>

                                <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 p-3">
                                    <p className="text-xs font-semibold text-amber-800">Context-Aware Detection</p>
                                    <p className="mt-1 text-xs text-amber-700">
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
