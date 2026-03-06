"use client";

import { useEffect, useState, useRef } from "react";
import {
    CheckCircle2,
    XCircle,
    Loader2,
    AlertTriangle,
} from "lucide-react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

type HealthData = {
    available: boolean;
    status: "ok" | "loading";
    models: {
        presidio: boolean;
        spacy_fast: boolean;
        spacy_full: boolean;
        errors: string[];
    };
};

function ModelDot({ loaded, label }: { loaded: boolean; label: string }) {
    return (
        <div className="flex items-center gap-2 text-sm">
            {loaded ? (
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
            ) : (
                <XCircle size={14} className="text-red-400 shrink-0" />
            )}
            <span className={loaded ? "text-foreground" : "text-muted-foreground"}>{label}</span>
        </div>
    );
}

export function AIModelStatusCard() {
    const [health, setHealth] = useState<HealthData | null>(null);
    const [error, setError] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function check() {
            try {
                const res = await fetch("/api/health");
                const data = await res.json();
                if (cancelled) return;
                setHealth(data);
                setError(false);

                // Stop polling once status is "ok"
                if (data.status === "ok" && intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            } catch {
                if (!cancelled) setError(true);
            }
        }

        check();
        // Auto-refresh every 10 seconds while loading
        intervalRef.current = setInterval(check, 10_000);

        return () => {
            cancelled = true;
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const isLoading = !health || health.status === "loading";
    const models = health?.models;

    return (
        <Card className="border border-border bg-card shadow-none">
            <CardHeader className="pb-3 px-5 pt-5">
                <CardTitle className="text-sm font-semibold text-foreground">
                    AI Model Status
                </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 flex flex-col gap-3">
                {error && !health && (
                    <p className="text-sm text-muted-foreground">Unable to reach Python service.</p>
                )}

                {isLoading && (
                    <div className="flex items-center gap-2 text-sm text-amber-700">
                        <Loader2 size={14} className="animate-spin" />
                        <span>AI models are loading… Large file uploads will be slower until loading completes.</span>
                    </div>
                )}

                {models && (
                    <div className="flex flex-col gap-2">
                        <ModelDot loaded={models.presidio} label="Presidio" />
                        <ModelDot loaded={models.spacy_fast} label="spaCy Fast" />
                        <ModelDot loaded={models.spacy_full} label="spaCy Full" />
                    </div>
                )}

                {models?.errors && models.errors.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                        <div className="flex flex-col gap-0.5">
                            {models.errors.map((err, i) => (
                                <span key={i}>{err}</span>
                            ))}
                        </div>
                    </div>
                )}

                {health?.status === "ok" && (
                    <p className="text-xs text-emerald-600 font-medium">All models loaded ✓</p>
                )}
            </CardContent>
        </Card>
    );
}
