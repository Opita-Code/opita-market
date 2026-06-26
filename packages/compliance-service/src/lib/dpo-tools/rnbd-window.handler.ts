/**
 * RNBD window alert Lambda handler — task 4.2 of compliance-foundation PR 4.
 *
 * Wired in sst.config.ts:
 *   new sst.aws.Function("RnbdWindowAlert", {
 *     handler: "packages/compliance-service/src/lib/dpo-tools/rnbd-window.handler",
 *     link: [...],
 *     permissions: ["cloudwatch:PutMetricData", "ses:SendEmail"],
 *   });
 *   new sst.aws.Cron("RnbdWindowCron", {
 *     schedule: "cron(0 11 ? 1-3 JAN-MAR *)",  // 1st of Jan/Feb/Mar @ 06:00 Colombia
 *     job: { function: "rnbd-window.handler" },
 *   });
 */

import { runRnbdWindowCheck } from "./rnbd-window.js";

export async function handler(): Promise<unknown> {
  const result = await runRnbdWindowCheck(new Date());
  // eslint-disable-next-line no-console
  console.log("[rnbd-window]", JSON.stringify(result));
  return result;
}

export { runRnbdWindowCheck, computeRnbdWindow, formatRnbdAlert } from "./rnbd-window.js";
export type { RnbdWindowResult, RnbdWindowState } from "./rnbd-window.js";