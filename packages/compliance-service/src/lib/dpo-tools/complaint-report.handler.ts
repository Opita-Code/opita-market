/**
 * Complaint report Lambda handler — task 4.3 of compliance-foundation PR 4.
 *
 * Wired in sst.config.ts:
 *   new sst.aws.Function("ComplaintReport", {
 *     handler: "packages/compliance-service/src/lib/dpo-tools/complaint-report.handler",
 *     link: [db, auditArchiveBucket],
 *     permissions: ["s3:PutObject", "cloudwatch:PutMetricData", "ses:SendEmail"],
 *   });
 *   new sst.aws.Cron("ComplaintReportCron", {
 *     schedule: "cron(0 11 24 2,8 ? *)",  // Feb 24 (H1 of next cycle) + Aug 24 (H2) @ 06:00 Colombia
 *     job: { function: "complaint-report.handler" },
 *   });
 */

import { runComplaintReport } from "./complaint-report.js";
import { makePgExecutor } from "../db-executor.js";

export async function handler(): Promise<unknown> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (SST Aurora link missing)");
  const bucket = process.env.AUDIT_ARCHIVE_BUCKET ?? "";
  if (!bucket) throw new Error("AUDIT_ARCHIVE_BUCKET is not set (SST bucket link missing)");
  const db = makePgExecutor(url);
  const result = await runComplaintReport({ db, bucket });
  // eslint-disable-next-line no-console
  console.log("[complaint-report]", JSON.stringify(result));
  return result;
}

export {
  runComplaintReport,
  halfOfYear,
  computeStats,
  fetchComplaintRows,
  renderReport,
  uploadReportToS3,
} from "./complaint-report.js";
export type { ComplaintReport, ComplaintReportResult, ComplaintReportRow, ComplaintReportStats } from "./complaint-report.js";