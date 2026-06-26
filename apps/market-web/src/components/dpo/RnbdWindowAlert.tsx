import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from "recharts";
import type { RnbdWindowState } from "./types";

interface Props {
  state: RnbdWindowState;
}

/**
 * Visual reminder for the DPO. The radial bar fills proportionally to the
 * elapsed time inside the 2 Jan - 31 Mar RNBD update window per
 * spec/data-protection-compliance "Annual RNBD Update" requirement.
 */
export default function RnbdWindowAlert({ state }: Props) {
  const start = new Date(state.window_start).getTime();
  const end = new Date(state.window_end).getTime();
  const now = Date.now();

  let fillValue = 0;
  if (state.in_window) {
    const elapsed = Math.max(0, now - start);
    const total = end - start;
    fillValue = Math.min(100, Math.round((elapsed / total) * 100));
  }

  const data = [
    {
      name: "RNBD",
      value: fillValue,
      fill: state.in_window ? "#0284c7" : "#cbd5e1",
    },
  ];

  const headline = state.in_window
    ? "Ventana de actualización RNBD abierta"
    : `Próxima ventana RNBD en ${state.days_until_open} días`;

  const detail = state.in_window
    ? `Cierra en ${state.days_until_close} días (31 de marzo).`
    : "Recuerde: 2 enero – 31 marzo de cada año.";

  const tone = state.in_window
    ? "border-amber-300 bg-amber-50"
    : "border-slate-200 bg-slate-50";

  return (
    <div className={`border ${tone} rounded-lg p-4`}>
      <div className="flex items-center gap-4">
        <div className="w-28 h-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="70%"
              outerRadius="100%"
              data={data}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar
                dataKey="value"
                cornerRadius={10}
                background={{ fill: "#e2e8f0" }}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{headline}</h3>
          <p className="text-sm text-slate-600 mt-1">{detail}</p>
          <p className="text-xs text-slate-500 mt-2 font-mono">
            {new Date(state.window_start).toLocaleDateString("es-CO")} →{" "}
            {new Date(state.window_end).toLocaleDateString("es-CO")}
          </p>
        </div>
      </div>
    </div>
  );
}