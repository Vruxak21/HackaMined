"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatLabel(raw: string): string {
  return raw
    .replace(/^IN_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  data: Array<{ name: string; value: number }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-foreground">{formatLabel(label)}</p>
      <p className="mt-0.5 text-muted-foreground">
        {payload[0].value.toLocaleString("en-IN")} occurrences
      </p>
    </div>
  );
}

export function PiiComparisonChart({ data }: Props) {
  if (!data.length) return null;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        barSize={28}
        margin={{ top: 4, right: 8, left: -10, bottom: 40 }}
      >
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeOpacity={0.6}
        />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickFormatter={formatLabel}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
