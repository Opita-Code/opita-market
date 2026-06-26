/**
 * CloudWatch metrics emission — wraps `@aws-sdk/client-cloudwatch` with a
 * single-function `putMetric` API. Used by the SLA monitor, RNBD window
 * cron, and complaint report cron to surface compliance signals to the
 * operator's dashboards.
 *
 * Namespace: `OpitaMarket/Compliance` (locked — do not change without
 * updating the corresponding CloudWatch alarms in sst.config.ts).
 *
 * Region is read from AWS_REGION (set automatically by Lambda).
 */

import { CloudWatchClient, PutMetricDataCommand, type StandardUnit } from "@aws-sdk/client-cloudwatch";

const NAMESPACE = "OpitaMarket/Compliance";

let _client: CloudWatchClient | null = null;

function client(): CloudWatchClient {
  if (!_client) {
    _client = new CloudWatchClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  }
  return _client;
}

export interface MetricInput {
  /** Metric name. Convention: PascalCase, e.g. `SLA_Breaches`. */
  name: string;
  /** Numeric value. */
  value: number;
  /** CloudWatch standard unit. Default `Count`. */
  unit?: StandardUnit;
  /** Optional dimensions for grouping. */
  dimensions?: ReadonlyArray<{ name: string; value: string }>;
}

/** Emit one or more metrics to CloudWatch. */
export async function putMetric(metrics: ReadonlyArray<MetricInput>): Promise<void> {
  if (metrics.length === 0) return;
  await client().send(
    new PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: metrics.map((m) => ({
        MetricName: m.name,
        Value: m.value,
        Unit: m.unit ?? "Count",
        Timestamp: new Date(),
        Dimensions: m.dimensions?.map((d) => ({ Name: d.name, Value: d.value })),
      })),
    }),
  );
}

/** Convenience helper — emit a single Count metric. */
export async function putCount(name: string, value: number, dimensions?: MetricInput["dimensions"]): Promise<void> {
  await putMetric([{ name, value, dimensions }]);
}

export const METRIC_NAMESPACE = NAMESPACE;