"use client";

import { useEffect, useState } from "react";
import {
    CheckCircle,
    ShieldCheck,
    ShieldOff,
    Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EncryptionStatus } from "@/lib/get-encryption-status";

const POLL_MS = 10_000; // refresh every 10 seconds

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

        // Kick off an immediate refresh so navigating to the page always
        // shows live data, then repeat on an interval.
        refresh();
        const id = setInterval(refresh, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    if (!enc) {
        return (
            <Card className="border border-amber-200 bg-amber-50 shadow-sm">
                <CardContent className="flex items-center gap-2 py-4 text-sm text-amber-700">
                    <ShieldOff size={16} className="shrink-0" />
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
        <Card className="border border-gray-100 shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
                    {allOk ? (
                        <ShieldCheck size={18} className="text-green-600" />
                    ) : (
                        <ShieldOff size={18} className="text-red-500" />
                    )}
                    Encryption Status
                    {loading && (
                        <Loader2 size={13} className="animate-spin text-gray-400" />
                    )}
                    <span
                        className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            allOk
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-700"
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
                                <CheckCircle size={15} className="mt-0.5 shrink-0 text-green-500" />
                            ) : (
                                <ShieldOff size={15} className="mt-0.5 shrink-0 text-red-500" />
                            )}
                            <span className="min-w-47.5 text-sm font-medium text-gray-700">
                                {label}
                            </span>
                            <span className="text-sm text-gray-500">{value}</span>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
