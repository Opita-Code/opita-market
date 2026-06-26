/**
 * RNBD window alert — task 4.2 of compliance-foundation PR 4.
 *
 * Spec: data-protection-compliance §"Annual RNBD Update":
 *   "The DPO MUST update the RNBD registration between 2 January and
 *    31 March each year."
 *
 * Runs monthly on the 1st at 06:00 Colombia (11:00 UTC) via SST `sst.aws.Cron`.
 * Outside the 2-Jan to 31-Mar window the function is a no-op (returns
 * `in_window: false` and emits no metric / no email).
 *
 * When the window is open, the function:
 *   1. Emits CloudWatch metric `RnbdWindowOpen = 1`.
 *   2. Sends an SES email to the DPO reminding them to update the RNBD
 *      registration (SIC deadline = 31 March).
 *
 * The same window computation is shared by `apps/market-web`'s DPO
 * dashboard widget (`components/dpo/rnbd-window.ts`) so this function
 * MUST stay consistent with that helper.
 *
 * Schedule (SST): `cron(0 11 ? 1-3 JAN-MAR *)` — 1st day of each month
 * from January through March, at 11:00 UTC. Months outside the range
 * never fire (EventBridge rejects the wildcard).
 */

import { putCount } from "./cloudwatch-metrics.js";
import { sendAlert } from "./ses-alerts.js";

export interface RnbdWindowState {
  in_window: boolean;
  days_until_close: number;
  window_start: string;
  window_end: string;
  reference_year: number;
}

/** Pure computation — same shape as the dashboard widget. */
export function computeRnbdWindow(now: Date = new Date()): RnbdWindowState {
  const year = now.getUTCFullYear();
  const windowStart = new Date(Date.UTC(year, 0, 2)); // 2 Jan
  const windowEnd = new Date(Date.UTC(year, 2, 31, 23, 59, 59)); // 31 Mar
  const nowMs = now.getTime();
  const inWindow = nowMs >= windowStart.getTime() && nowMs <= windowEnd.getTime();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilClose = inWindow ? Math.max(0, Math.ceil((windowEnd.getTime() - nowMs) / msPerDay)) : 0;
  return {
    in_window: inWindow,
    days_until_close: daysUntilClose,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    reference_year: year,
  };
}

export interface RnbdWindowResult {
  ran_at: string;
  state: RnbdWindowState;
  metric_emitted: number;
  email_message_id: string | null;
}

/** Format the DPO alert body for the open-window case. */
export function formatRnbdAlert(state: RnbdWindowState): string {
  return [
    `Opita Market — Ventana RNBD abierta`,
    ``,
    `El periodo de actualización anual del Registro Nacional de Bases de`,
    `Datos (RNBD) ante la SIC está ABIERTO.`,
    ``,
    `• Inicio: ${state.window_start.slice(0, 10)}`,
    `• Cierre: ${state.window_end.slice(0, 10)}`,
    `• Días restantes para cierre: ${state.days_until_close}`,
    ``,
    `Acción requerida: ingrese al portal RNBD de la SIC y actualice los`,
    `registros de las bases de datos de Opita Market S.A.S. conforme al`,
    `Decreto 886/2014. Almacene el comprobante como artefacto inmutable`,
    `en el bucket AuditArchive (objetivo: PR 5 del change compliance-foundation).`,
    ``,
    `Panel DPO: https://market.opitacode.com/admin/dpo`,
  ].join("\n");
}

/** Run the RNBD window check. */
export async function runRnbdWindowCheck(now: Date = new Date()): Promise<RnbdWindowResult> {
  const state = computeRnbdWindow(now);

  let metricEmitted = 0;
  let emailMessageId: string | null = null;

  if (state.in_window) {
    metricEmitted = 1;
    await putCount("RnbdWindowOpen", 1, [
      { name: "Stage", value: process.env.SST_STAGE ?? "dev" },
    ]);
    emailMessageId = await sendAlert({
      subject: `[Opita Market] Ventana RNBD abierta — ${state.days_until_close} día(s) para el cierre`,
      bodyText: formatRnbdAlert(state),
    });
  }

  return {
    ran_at: now.toISOString(),
    state,
    metric_emitted: metricEmitted,
    email_message_id: emailMessageId,
  };
}