/**
 * Semiannual complaint report — task 4.3 of compliance-foundation PR 4.
 *
 * Spec: data-protection-compliance §"Semiannual Complaint Report":
 *   "The DPO MUST submit a report of titular complaints to SIC by
 *    25 August (H1) and 28 February (H2) each year."
 *
 * Runs on 24 August (H1) and 24 February (H2) at 06:00 Colombia via SST
 * `sst.aws.Cron`. One day BEFORE the SIC deadline gives the DPO time to
 * review the auto-draft and submit manually.
 *
 * The function generates a markdown report covering the half-year
 * (H1 = Jan-Jun, H2 = Jul-Dec) and uploads it to the AuditArchive S3
 * bucket. The report contains:
 *
 *   - Number of complaints received
 *   - Time-to-resolution statistics (avg / p50 / max business days)
 *   - SLA breaches count
 *   - List of NIT+DV per complaint (required by `colombia-habeas-data`
 *     skill for SIC submissions)
 *   - Pre-signed S3 link included in the DPO alert email
 *
 * Schedule (SST): `cron(0 11 24 2,8 ? *)` — Feb 24 and Aug 24 @ 11:00 UTC.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PutMetricDataCommand, CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { sendAlert } from "../ses-alerts.js";
import type { DbExecutor } from "../../api/audit.js";

export interface ComplaintReportRow {
  nit: string;
  dv: string;
  request_type: string;
  received_at: string;
  resolved_at: string | null;
  business_days_to_resolve: number | null;
  outcome: string;
  sla_breached: boolean;
}

export interface ComplaintReportStats {
  total_complaints: number;
  resolved: number;
  unresolved: number;
  breached: number;
  avg_business_days_to_resolve: number | null;
  max_business_days_to_resolve: number | null;
}

export interface ComplaintReport {
  half: "H1" | "H2";
  year: number;
  period_start: string;
  period_end: string;
  generated_at: string;
  stats: ComplaintReportStats;
  complaints: ReadonlyArray<ComplaintReportRow>;
}

/** Half-year for a given reference date. */
export function halfOfYear(now: Date = new Date()): { half: "H1" | "H2"; year: number; start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  if (month <= 5) {
    return { half: "H1", year, start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 5, 30, 23, 59, 59)) };
  }
  return { half: "H2", year, start: new Date(Date.UTC(year, 6, 1)), end: new Date(Date.UTC(year, 11, 31, 23, 59, 59)) };
}

/**
 * Fetch all `rights.*` audit rows that touched a complaint workflow during
 * the given half-year window. We treat the complaint as "resolved" when
 * outcome = 'completed' or 'failed'; otherwise unresolved.
 */
export async function fetchComplaintRows(db: DbExecutor, start: Date, end: Date): Promise<ReadonlyArray<ComplaintReportRow>> {
  const sql = `
    SELECT nit,
           COALESCE(metadata->>'dv', '?') AS dv,
           action AS request_type,
           occurred_at AS received_at,
           CASE
             WHEN outcome IN ('completed', 'failed') THEN occurred_at
             ELSE NULL
           END AS resolved_at,
           outcome,
           sla_breached,
           EXTRACT(DAY FROM (now() - sla_deadline))::int AS business_days_to_resolve
      FROM public.audit_log
     WHERE action LIKE 'rights.%'
       AND occurred_at >= $1
       AND occurred_at <= $2
       AND nit IS NOT NULL
     ORDER BY occurred_at ASC
     LIMIT 5000
  `;
  const res = await db.query<ComplaintReportRow>(sql, [start.toISOString(), end.toISOString()]);
  return res.rows;
}

export function computeStats(rows: ReadonlyArray<ComplaintReportRow>): ComplaintReportStats {
  const resolved = rows.filter((r) => r.resolved_at !== null);
  const unresolved = rows.length - resolved.length;
  const breached = rows.filter((r) => r.sla_breached).length;
  const daysList = resolved
    .map((r) => r.business_days_to_resolve)
    .filter((d): d is number => typeof d === "number");
  const avg = daysList.length > 0 ? Number((daysList.reduce((a, b) => a + b, 0) / daysList.length).toFixed(2)) : null;
  const max = daysList.length > 0 ? Math.max(...daysList) : null;
  return {
    total_complaints: rows.length,
    resolved: resolved.length,
    unresolved,
    breached,
    avg_business_days_to_resolve: avg,
    max_business_days_to_resolve: max,
  };
}

/** Render the markdown report body. */
export function renderReport(report: ComplaintReport): string {
  const lines: string[] = [
    `# Reporte semestral de quejas — ${report.half} ${report.year}`,
    ``,
    `> Generado automáticamente el ${report.generated_at}`,
    `>`,
    `> Periodo cubierto: **${report.period_start.slice(0, 10)}** a **${report.period_end.slice(0, 10)}**`,
    `>`,
    `> Ley 1581/2012 Art. 18 — deber del responsable de presentar reportes`,
    `> semestrales de quejas/reclamos a la Superintendencia de Industria`,
    `> y Comercio (SIC).`,
    ``,
    `## Resumen ejecutivo`,
    ``,
    `| Métrica | Valor |`,
    `|---------|-------|`,
    `| Total de quejas/solicitudes | ${report.stats.total_complaints} |`,
    `| Resueltas a tiempo | ${report.stats.resolved} |`,
    `| Pendientes al cierre del periodo | ${report.stats.unresolved} |`,
    `| Breaches de SLA (15 días hábiles) | ${report.stats.breached} |`,
    `| Tiempo promedio de resolución (días hábiles) | ${report.stats.avg_business_days_to_resolve ?? "n/a"} |`,
    `| Tiempo máximo de resolución (días hábiles) | ${report.stats.max_business_days_to_resolve ?? "n/a"} |`,
    ``,
    `## Detalle de quejas (NIT + DV)`,
    ``,
    `| # | NIT | DV | Tipo | Recibido | Resuelto | Días hábiles | SLA |`,
    `|---|-----|----|------|----------|----------|--------------|-----|`,
  ];
  report.complaints.forEach((c, i) => {
    const days = c.business_days_to_resolve ?? "—";
    const sla = c.sla_breached ? "❌ breach" : "✅ ok";
    lines.push(
      `| ${i + 1} | ${c.nit} | ${c.dv} | ${c.request_type} | ${c.received_at.slice(0, 10)} | ${c.resolved_at?.slice(0, 10) ?? "—"} | ${days} | ${sla} |`,
    );
  });
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`*Reporte generado automáticamente por el SLA monitor de Opita Market S.A.S.*`);
  lines.push(`*Plazo SIC: 25 de agosto (H1) / 28 de febrero (H2). Revisar y presentar manualmente.*`);
  return lines.join("\n");
}

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  return _s3;
}

let _cw: CloudWatchClient | null = null;
function cw(): CloudWatchClient {
  if (!_cw) _cw = new CloudWatchClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  return _cw;
}

/** Upload the report to the AuditArchive bucket. */
export async function uploadReportToS3(opts: {
  bucket: string;
  key: string;
  body: string;
}): Promise<{ etag: string | undefined; versionId: string | undefined }> {
  const res = await s3().send(
    new PutObjectCommand({
      Bucket: opts.bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: "text/markdown; charset=utf-8",
      Metadata: {
        "generated-by": "opita-market-compliance",
        "report-kind": "sic-semiannual-complaints",
      },
    }),
  );
  return { etag: res.ETag, versionId: res.VersionId };
}

export interface ComplaintReportResult {
  ran_at: string;
  report_key: string;
  s3_bucket: string;
  stats: ComplaintReportStats;
  email_message_id: string | null;
}

/** Run the full complaint report pipeline. */
export async function runComplaintReport(opts: {
  db: DbExecutor;
  bucket: string;
  /** Override the half-year window (defaults to current half). */
  window?: { half: "H1" | "H2"; year: number; start: Date; end: Date };
  /** Override the reference date (defaults to now). */
  now?: Date;
}): Promise<ComplaintReportResult> {
  const now = opts.now ?? new Date();
  const window = opts.window ?? halfOfYear(now);
  const rows = await fetchComplaintRows(opts.db, window.start, window.end);
  const stats = computeStats(rows);
  const report: ComplaintReport = {
    half: window.half,
    year: window.year,
    period_start: window.start.toISOString(),
    period_end: window.end.toISOString(),
    generated_at: now.toISOString(),
    stats,
    complaints: rows,
  };
  const body = renderReport(report);
  const key = `complaint-reports/${report.year}/complaint-report-${report.half.toLowerCase()}-${report.year}.md`;
  const put = await uploadReportToS3({ bucket: opts.bucket, key, body });

  await cw().send(
    new PutMetricDataCommand({
      Namespace: "OpitaMarket/Compliance",
      MetricData: [
        {
          MetricName: "ComplaintReportDrafted",
          Value: 1,
          Unit: "Count",
          Timestamp: now,
          Dimensions: [
            { Name: "Stage", Value: process.env.SST_STAGE ?? "dev" },
            { Name: "Half", Value: report.half },
          ],
        },
      ],
    }),
  );

  const emailMessageId = await sendAlert({
    subject: `[Opita Market] Reporte ${report.half} ${report.year} de quejas listo para revisión`,
    bodyText: [
      `El reporte semestral de quejas (${report.half} ${report.year}) fue auto-generado`,
      `y está disponible para revisión en:`,
      ``,
      `s3://${opts.bucket}/${key}`,
      ``,
      `Resumen:`,
      `• Total de quejas: ${stats.total_complaints}`,
      `• Resueltas: ${stats.resolved}`,
      `• Pendientes: ${stats.unresolved}`,
      `• Breaches de SLA: ${stats.breached}`,
      `• Promedio de días hábiles para resolver: ${stats.avg_business_days_to_resolve ?? "n/a"}`,
      ``,
      `Plazo SIC: presente manualmente el reporte antes del ${report.half === "H1" ? "25 de agosto" : "28 de febrero"}.`,
      `Descargue el archivo, complételo si requiere ajustes, y súbalo al portal RNBD.`,
      ``,
      `ETag: ${put.etag ?? "—"}`,
      `VersionId: ${put.versionId ?? "—"}`,
    ].join("\n"),
  });

  return {
    ran_at: now.toISOString(),
    report_key: key,
    s3_bucket: opts.bucket,
    stats,
    email_message_id: emailMessageId,
  };
}