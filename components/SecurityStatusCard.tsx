"use client";

import { useEffect, useState } from "react";
import {
    CheckCircle2,
    ShieldCheck,
    ShieldOff,
    Loader2,
    Circle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EncryptionStatus } from "@/lib/get-encryption-status";

const POLL_MS = 10_000;

export function SecurityStatusCard({
    initial,
}: {
    initial: EncryptionStatus | null;
}) {
    const [enc, setEnc] = useState<EncryptionStatus | null>(initial);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function refresh() {
            setLoading(true);
            try {
                const res = await fetch("/api/admin/encryption-status", {
                    cache: "no-store",
                });
                if (!cancelled && res.ok) {
                    setEnc(await res.json());
                }
            } catch {
                // keep the last known value
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        refresh();
        const id = setInterval(refresh, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    if (!enc) {
        return (
            <Card className="border border-border bg-card shadow-none">
                <CardContent className="flex items-center gap-2.5 py-4 text-sm text-muted-foreground">
                    <ShieldOff size={14} className="shrink-0" />
                    Encryption status unavailable — ensure the app is running with the correct environment variables.
                </CardContent>
            </Card>
        );
    }

    const atRest = enc.encryptionAtRest;
    const inTransit = enc.encryptionInTransit;

    const layers = [
        {
            label: "Browser → Server",
            value: inTransit.browserToServer,
            ok: inTransit.browserToServer === "HTTPS",
        },
        {
            label: "Server → Python service",
            value: inTransit.serverToPython,
            ok: inTransit.serverToPython.startsWith("HMAC"),
        },
        {
            label: "Server → Database",
            value: inTransit.serverToDatabase,
            ok: inTransit.serverToDatabase.startsWith("SSL"),
        },
        {
            label: "Data at Rest",
            value:
                atRest.status === "active"
                    ? `${atRest.algorithm} · key v${atRest.keyVersion} · ${atRest.fieldsEncrypted.length} fields`
                    : atRest.status === "partial"
                        ? `Partially encrypted (${atRest.fieldsFailed.length} field(s) unencrypted)`
                        : "No data yet — upload a file to verify",
            ok: atRest.status === "active" || atRest.status === "no_data",
        },
    ];

    const allOk = layers.every((l) => l.ok);

    return (
        <Card className="border border-border bg-card shadow-none">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {allOk ? (
                        <ShieldCheck size={15} className="text-primary shrink-0" />
                    ) : (
                        <ShieldOff size={15} className="text-destructive shrink-0" />
                    )}
                    Encryption Status
                    {loading && (
                        <Loader2 size={12} className="animate-spin text-muted-foreground ml-0.5" />
                    )}
                    <span
                        className={`ml-auto rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${allOk
                                ? "bg-primary/12 text-primary"
                                : "bg-destructive/10 text-destructive"
                            }`}
                    >
                        {allOk ? "All Active" : "Issues Detected"}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
                <ul className="space-y-2.5">
                    {layers.map(({ label, value, ok }) => (
                        <li key={label} className="flex items-start gap-3">
                            {ok ? (
                                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-primary" />
                            ) : (
                                <Circle size={13} className="mt-0.5 shrink-0 text-destructive" />
                            )}
                            <span className="min-w-47.5 text-sm font-medium text-foreground">
                                {label}
                            </span>
                            <span className="text-sm text-muted-foreground">{value}</span>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
