/**
 * SLA monitor Lambda handler — task 4.1 of compliance-foundation PR 4.
 *
 * Wrapped as a Lambda function via SST (see sst.config.ts):
 *   new sst.aws.Function("SlaMonitor", {
 *     handler: "packages/compliance-service/src/lib/sla-monitor.handler",
 *     link: [db, ...],
 *     permissions: ["cloudwatch:PutMetricData", "ses:SendEmail", "ses:SendRawEmail"],
 *   });
 *   new sst.aws.Cron("SlaMonitorCron", {
 *     schedule: "cron(0 11 * * ? *)",   // 06:00 America/Bogota = 11:00 UTC
 *     job: { function: "sla-monitor.handler" },
 *   });
 *
 * Cold start: instantiates a pg pool + the audit writer. Connection reuses
 * across invocations via the Lambda container.
 */

import { Pool } from "pg";
import { runSlaMonitor } from "./sla-monitor.js";
import { makePgExecutor } from "./db-executor.js";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set (SST Aurora link missing)");
    }
    _pool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000 });
  }
  return _pool;
}

export async function handler(): Promise<unknown> {
  const db = makePgExecutor(process.env.DATABASE_URL ?? "");
  const result = await runSlaMonitor(db);
  // eslint-disable-next-line no-console
  console.log("[sla-monitor]", JSON.stringify(result));
  return result;
}

// Re-export the library entry points so unit tests can exercise the logic
// without spinning up a real Lambda.
export { runSlaMonitor, findBreachedRows, flagBreachedRows, formatBreachAlert } from "./sla-monitor.js";
export type { SlaMonitorResult, BreachedRow } from "./sla-monitor.js";