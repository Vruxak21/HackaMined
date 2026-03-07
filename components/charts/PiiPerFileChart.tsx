"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function trimName(name: string, max = 18): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

interface Props {
  data: Array<{ name: string; total: number }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-foreground max-w-48 wrap-break-word">{entry.payload.name}</p>
      <p className="mt-0.5 text-muted-foreground">
        {entry.value.toLocaleString("en-IN")} PII entities
      </p>
    </div>
  );
}

export function PiiPerFileChart({ data }: Props) {
  if (!data.length) return null;

  // Compute dynamic height: 32px per bar row + margins
  const barHeight = Math.max(260, data.length * 32 + 40);

  return (
    <ResponsiveContainer width="100%" height={barHeight}>
      <BarChart
        data={data}
        layout="vertical"
        barSize={18}
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
      >
        <CartesianGrid
          horizontal={false}
          stroke="var(--border)"
          strokeOpacity={0.6}
        />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickFormatter={trimName}
          width={110}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <Bar dataKey="total" fill="var(--chart-1)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
