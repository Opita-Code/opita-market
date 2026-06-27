/**
 * SES email wrapper for compliance alerts. Wraps `@aws-sdk/client-ses` SendEmail
 * so the SLA monitor, RNBD window cron, and complaint report cron can fire
 * DPO alerts with a single function call.
 *
 * Sender identity: read from `process.env.SES_FROM_ADDRESS`. SST wires this
 * automatically when the Function is `link`ed to a `sst.aws.Email` resource.
 *
 * Recipients: read from `process.env.DPO_EMAILS` (comma-separated). Mirrors
 * the API surface used by the audit log query endpoint.
 *
 * NOTE: AWS SES starts in SANDBOX mode. Sandbox only delivers to verified
 * recipient addresses. Operators must request production access via the AWS
 * console before relying on this for live alerting. See README §"SES Sandbox".
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

let _client: SESClient | null = null;

function client(): SESClient {
  if (!_client) {
    _client = new SESClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  }
  return _client;
}

export interface SendAlertOptions {
  /** Subject line. Plain text. */
  subject: string;
  /** Plain-text body. Already newline-formatted. */
  bodyText: string;
  /** Optional HTML body. Falls back to text-only if omitted. */
  bodyHtml?: string;
  /** Override recipient list (defaults to DPO_EMAILS env). */
  to?: ReadonlyArray<string>;
  /** Override sender (defaults to SES_FROM_ADDRESS env). */
  from?: string;
}

function getDefaultFrom(): string {
  const from = process.env.SES_FROM_ADDRESS ?? "";
  if (!from) {
    throw new Error("SES_FROM_ADDRESS is not set (SST link to sst.aws.Email missing?)");
  }
  return from;
}

function getDefaultRecipients(): ReadonlyArray<string> {
  const raw = process.env.DPO_EMAILS ?? "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) {
    throw new Error("DPO_EMAILS is empty — set at least one DPO recipient");
  }
  return list;
}

/** Send an alert email. Returns the AWS SES MessageId. */
export async function sendAlert(opts: SendAlertOptions): Promise<string> {
  const from = opts.from ?? getDefaultFrom();
  const to = (opts.to ?? getDefaultRecipients()).slice();
  const body: { Text: { Data: string; Charset: string }; Html?: { Data: string; Charset: string } } = {
    Text: { Data: opts.bodyText, Charset: "UTF-8" },
  };
  if (opts.bodyHtml) {
    body.Html = { Data: opts.bodyHtml, Charset: "UTF-8" };
  }
  const res = await client().send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: to },
      Message: {
        Subject: { Data: opts.subject, Charset: "UTF-8" },
        Body: body,
      },
    }),
  );
  return res.MessageId ?? "(unknown)";
}