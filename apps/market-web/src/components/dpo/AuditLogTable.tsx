import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import type { AuditEntry } from "./types";

interface Props {
  entries: AuditEntry[];
  loading?: boolean;
  error?: string | null;
}

const actionLabel: Record<string, string> = {
  "nit-dv.lookup": "Verificación NIT+DV",
  "rights.know": "Derecho de conocer",
  "rights.update": "Derecho de actualizar",
  "rights.rectify": "Derecho de rectificar",
  "rights.suppress": "Derecho de suprimir",
  "consent.granted": "Consentimiento otorgado",
  "consent.revoked": "Consentimiento revocado",
};

export default function AuditLogTable({ entries, loading, error }: Props) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "timestamp", desc: true },
  ]);

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: "timestamp",
        header: "Fecha",
        cell: (info) => {
          const iso = info.getValue<string>();
          return new Date(iso).toLocaleString("es-CO", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
        },
      },
      {
        accessorKey: "action",
        header: "Acción",
        cell: (info) => {
          const a = info.getValue<string>();
          return (
            <span className="font-mono text-xs">
              {actionLabel[a] ?? a}
            </span>
          );
        },
      },
      {
        accessorKey: "nit",
        header: "NIT",
        cell: (info) => {
          const v = info.getValue<string | null>();
          return v ? <span className="font-mono">{v}</span> : "—";
        },
      },
      {
        accessorKey: "outcome",
        header: "Resultado",
        cell: (info) => {
          const v = info.getValue<string>();
          const cls =
            v === "verified" || v === "completed"
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800";
          return (
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}
            >
              {v}
            </span>
          );
        },
      },
      {
        accessorKey: "dpo_signoff",
        header: "DPO sign-off",
        cell: (info) => {
          const v = info.getValue<string | null>();
          return v ? (
            <span className="text-xs text-slate-600">{v}</span>
          ) : (
            <span className="text-slate-400 text-xs">—</span>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: entries,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (loading) {
    return (
      <div className="text-sm text-slate-500 italic py-8 text-center">
        Cargando auditoría…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800">
        Error al cargar la auditoría: {error}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic py-8 text-center">
        No hay entradas de auditoría en el rango seleccionado.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="px-3 py-2 text-left font-semibold text-slate-700 cursor-pointer select-none"
                  onClick={h.column.getToggleSortingHandler()}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {h.column.getIsSorted() === "asc" && " ▲"}
                  {h.column.getIsSorted() === "desc" && " ▼"}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}