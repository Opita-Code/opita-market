import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { SlaMetric } from "./types";

interface Props {
  metrics: SlaMetric[];
}

interface Row {
  week: string;
  "A tiempo": number;
  "Vencidas": number;
}

export default function SlaMetricsChart({ metrics }: Props) {
  const data: Row[] = metrics.map((m) => ({
    week: m.week,
    "A tiempo": m.requests_resolved_on_time,
    "Vencidas": m.requests_breached,
  }));

  if (data.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic py-8 text-center">
        Aún no hay métricas de SLA para graficar.
      </div>
    );
  }

  const totalReceived = metrics.reduce(
    (acc, m) => acc + m.requests_received,
    0,
  );
  const totalBreached = metrics.reduce(
    (acc, m) => acc + m.requests_breached,
    0,
  );
  const compliancePct =
    totalReceived === 0
      ? 100
      : Math.round(((totalReceived - totalBreached) / totalReceived) * 1000) /
        10;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-600">
          Cumplimiento de SLA (15 días hábiles)
        </p>
        <span
          className={`text-sm font-semibold ${
            compliancePct >= 95
              ? "text-green-700"
              : compliancePct >= 80
                ? "text-amber-700"
                : "text-red-700"
          }`}
        >
          {compliancePct}% cumplimiento
        </span>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="week"
              stroke="#475569"
              fontSize={11}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis stroke="#475569" fontSize={11} />
            <Tooltip />
            <Legend />
            <Bar dataKey="A tiempo" stackId="a" fill="#0284c7" />
            <Bar dataKey="Vencidas" stackId="a" fill="#dc2626" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}