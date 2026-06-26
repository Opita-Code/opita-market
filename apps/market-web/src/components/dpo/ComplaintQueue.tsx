import { useMemo } from "react";
import type { ComplaintEntry } from "./types";

interface Props {
  complaints: ComplaintEntry[];
  loading?: boolean;
  error?: string | null;
}

const typeLabel: Record<ComplaintEntry["request_type"], string> = {
  know: "Conocer",
  update: "Actualizar",
  rectify: "Rectificar",
  suppress: "Suprimir",
};

const statusStyle: Record<ComplaintEntry["status"], string> = {
  received: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
  rejected: "bg-slate-200 text-slate-700",
};

function businessDaysUntil(deadlineIso: string, now: Date = new Date()): number {
  const deadline = new Date(deadlineIso);
  const ms = deadline.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function ComplaintQueue({ complaints, loading, error }: Props) {
  const sorted = useMemo(() => {
    return [...complaints].sort((a, b) => {
      const da = new Date(a.sla_deadline).getTime();
      const db = new Date(b.sla_deadline).getTime();
      return da - db;
    });
  }, [complaints]);

  if (loading) {
    return (
      <div className="text-sm text-slate-500 italic py-8 text-center">
        Cargando quejas…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800">
        Error al cargar quejas: {error}
      </div>
    );
  }
  if (sorted.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic py-8 text-center">
        No hay solicitudes de derechos pendientes.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden bg-white">
      {sorted.map((c) => {
        const daysLeft = businessDaysUntil(c.sla_deadline);
        const isBreached = daysLeft < 0 && c.status !== "resolved";
        const isUrgent = daysLeft <= 3 && c.status !== "resolved";
        return (
          <li
            key={c.request_id}
            className="px-4 py-3 flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-slate-500">
                  {c.request_id.slice(0, 8)}
                </span>
                <span className="font-medium text-slate-900">
                  {typeLabel[c.request_type]}
                </span>
                <span className="text-xs text-slate-500">
                  NIT <span className="font-mono">{c.nit}</span>
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${statusStyle[c.status]}`}
                >
                  {c.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Recibida:{" "}
                {new Date(c.received_at).toLocaleDateString("es-CO")} ·
                SLA hasta{" "}
                {new Date(c.sla_deadline).toLocaleDateString("es-CO")} ·
                canal {c.channel}
              </div>
            </div>
            <div className="text-right shrink-0">
              {c.status === "resolved" ? (
                <span className="text-xs text-green-700 font-medium">
                  Cerrada
                </span>
              ) : isBreached ? (
                <span className="text-xs text-red-700 font-semibold">
                  Vencida {Math.abs(daysLeft)}d
                </span>
              ) : isUrgent ? (
                <span className="text-xs text-amber-700 font-semibold">
                  {daysLeft}d hábiles
                </span>
              ) : (
                <span className="text-xs text-slate-600">
                  {daysLeft}d hábiles
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}