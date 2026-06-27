/**
 * SLA monitor — task 4.1 of compliance-foundation PR 4.
 *
 * Spec: data-protection-compliance §"Audit Log Retention" +
 *       titular-rights-workflows §"15-Business-Day SLA" §"SLA breach detected".
 *
 * Runs daily at 06:00 Colombia time (11:00 UTC) via SST `sst.aws.Cron`.
 * For each `audit_log` row where:
 *   - action starts with "rights."
 *   - outcome NOT IN ('completed', 'failed')
 *   - sla_deadline < now()
 * ...emits a CloudWatch metric `SLA_Breaches` (count) and sends an SES
 * email to the DPO listing the breached rows.
 *
 * After alerting, the row's `sla_breached` column is set to TRUE so the
 * downstream DPO dashboard can surface breach severity without re-computing.
 * Idempotency: rows already marked `sla_breached = TRUE` are skipped.
 *
 * Schedule (SST): `cron(0 11 * * ? *)` — every day at 11:00 UTC = 06:00
 * America/Bogota (Colombia is UTC-5 year-round; no DST since 1993).
 */

import { putCount, METRIC_NAMESPACE } from "./cloudwatch-metrics.js";
import { sendAlert } from "./ses-alerts.js";
import { isSlaBreached } from "./sla-math.js";
import type { DbExecutor } from "../api/audit.js";

export interface BreachedRow {
  id: number;
  action: string;
  nit: string | null;
  occurred_at: string;
  sla_deadline: string;
  days_overdue: number;
  outcome: string;
}

export interface SlaMonitorResult {
  scanned: number;
  breached: number;
  metric_namespace: string;
  metric_emitted: number;
  email_message_id: string | null;
  ran_at: string;
}

/** Query audit_log for SLA-breached rows that haven't been flagged yet. */
export async function findBreachedRows(db: DbExecutor): Promise<ReadonlyArray<BreachedRow>> {
  const sql = `
    SELECT id, action, nit, occurred_at, sla_deadline, outcome,
           EXTRACT(DAY FROM (now() - sla_deadline))::int AS days_overdue
      FROM public.audit_log
     WHERE sla_breached = false
       AND sla_deadline IS NOT NULL
       AND sla_deadline < now()
       AND outcome NOT IN ('completed', 'failed')
       AND action LIKE 'rights.%'
     ORDER BY sla_deadline ASC
     LIMIT 200
  `;
  const res = await db.query<BreachedRow>(sql);
  return res.rows;
}

/** Mark the given audit rows as breached (idempotent). */
export async function flagBreachedRows(db: DbExecutor, ids: ReadonlyArray<number>): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `UPDATE public.audit_log
        SET sla_breached = true
      WHERE id = ANY($1::bigint[])
        AND sla_breached = false`,
    [ids],
  );
}

/** Format a human-readable plain-text body for the SES alert. */
export function formatBreachAlert(rows: ReadonlyArray<BreachedRow>): string {
  if (rows.length === 0) {
    return "Sin novedades — no se detectaron breaches de SLA en el ciclo de hoy.";
  }
  const lines: string[] = [
    `Opita Market — Alerta de SLA (Ley 1581/2012 Art. 11 — 15 días hábiles)`,
    ``,
    `Se detectaron ${rows.length} solicitud(es) de derechos con SLA vencido:`,
    ``,
  ];
  for (const r of rows) {
    lines.push(
      `• ID=${r.id}  action=${r.action}  nit=${r.nit ?? "?"}-${"(DV n/a)"}  outcome=${r.outcome}`,
    );
    lines.push(
      `    occurred_at=${r.occurred_at}  sla_deadline=${r.sla_deadline}  days_overdue=${r.days_overdue}`,
    );
  }
  lines.push(``);
  lines.push(`Acción requerida: revisar cada caso en el panel DPO (`);
  lines.push(`https://market.opitacode.com/admin/dpo) y responder dentro del plazo`);
  lines.push(`ampliado de 8 días hábiles que permite el Decreto 1377/2013.`);
  return lines.join("\n");
}

/** Run the SLA monitor end-to-end against the supplied DB executor. */
export async function runSlaMonitor(db: DbExecutor): Promise<SlaMonitorResult> {
  const now = new Date();
  const rows = await findBreachedRows(db);
  // Filter once more in code for an extra defense-in-depth check against
  // misbehaving system clocks.
  const breached = rows.filter((r) => isSlaBreached(r.sla_deadline, now));

  let emailMessageId: string | null = null;
  if (breached.length > 0) {
    emailMessageId = await sendAlert({
      subject: `[Opita Market] ${breached.length} SLA breach${breached.length === 1 ? "" : "es"} detected`,
      bodyText: formatBreachAlert(breached),
    });
  }

  // Always emit the metric — zero counts are useful too (the alarm uses
  // "no breach in 24h" as an OK signal in dashboards).
  await putCount("SLA_Breaches", breached.length, [
    { name: "Stage", value: process.env.SST_STAGE ?? "dev" },
  ]);

  if (breached.length > 0) {
    await flagBreachedRows(db, breached.map((r) => r.id));
  }

  return {
    scanned: rows.length,
    breached: breached.length,
    metric_namespace: METRIC_NAMESPACE,
    metric_emitted: breached.length,
    email_message_id: emailMessageId,
    ran_at: now.toISOString(),
  };
}