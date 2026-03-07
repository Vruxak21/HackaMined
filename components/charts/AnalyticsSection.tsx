"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PiiDistributionChart } from "./PiiDistributionChart";
import { PiiComparisonChart } from "./PiiComparisonChart";
import { PiiPerFileChart } from "./PiiPerFileChart";
import { DetectionLayerChart } from "./DetectionLayerChart";

interface AnalyticsData {
  piiDistribution: Array<{ name: string; value: number }>;
  layerBreakdown: Array<{ name: string; value: number }>;
  piiPerFile: Array<{ name: string; total: number }>;
}

function ChartSkeleton() {
  return (
    <div className="h-65 w-full animate-pulse rounded-md bg-muted/50" />
  );
}

function EmptyChart() {
  return (
    <div className="flex h-65 w-full items-center justify-center">
      <p className="text-xs text-muted-foreground">
        No data yet — process files to see analytics.
      </p>
    </div>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <Card className="border border-border shadow-none">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent className="px-5 pb-5">{children}</CardContent>
    </Card>
  );
}

export function AnalyticsSection() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/analytics/pii-distribution");
        if (!res.ok) throw new Error("Request failed");
        const json = await res.json() as AnalyticsData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const noData =
    !loading &&
    !error &&
    data &&
    data.piiDistribution.length === 0 &&
    data.piiPerFile.length === 0;

  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">PII Analytics</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Aggregated insights from all processed files
        </p>
      </div>

      {error && (
        <p className="text-xs text-destructive">
          Failed to load analytics. Please refresh the page.
        </p>
      )}

      {noData && (
        <p className="text-xs text-muted-foreground">
          No processed files found. Upload and scan files to see analytics here.
        </p>
      )}

      {!error && !noData && (
        <>
          {/* Row 1: Distribution + Detection Layer */}
          <div className="grid gap-4 lg:grid-cols-2 mb-4">
            <ChartCard
              title="Global PII Distribution"
              subtitle="Proportion of each PII type across all files"
            >
              {loading ? (
                <ChartSkeleton />
              ) : data?.piiDistribution.length ? (
                <PiiDistributionChart data={data.piiDistribution} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>

            <ChartCard
              title="Detection Layer Contribution"
              subtitle="How each pipeline layer contributes to detections"
            >
              {loading ? (
                <ChartSkeleton />
              ) : data?.layerBreakdown.length ? (
                <DetectionLayerChart data={data.layerBreakdown} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
          </div>

          {/* Row 2: Type comparison + Per file breakdown */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="PII Type Comparison"
              subtitle="Total occurrences of each detected PII category"
            >
              {loading ? (
                <ChartSkeleton />
              ) : data?.piiDistribution.length ? (
                <PiiComparisonChart data={data.piiDistribution} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>

            <ChartCard
              title="PII Detected per File"
              subtitle="Top files by number of PII entities found"
            >
              {loading ? (
                <ChartSkeleton />
              ) : data?.piiPerFile.length ? (
                <PiiPerFileChart data={data.piiPerFile} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
}
