# Opita Market — Operations Runbook

This runbook is the source of truth for everything that happens AFTER
the first `sst deploy --stage prod` for `opita-market`. It is
deliberately procedural (step-by-step) so the on-call operator can act
without re-reading the source code or asking the DPO.

Scope:

- **DPO Handoff** — onboarding a new DPO + rotating the shared JWT secret.
- **Annual Compliance Ops** — RNBD annual update, semiannual complaint
  reports, Colombian holidays list maintenance.
- **Daily Operations** — SLA monitor cron, CloudWatch dashboard, alert
  escalation paths.
- **Incident Response** — what to do when an alarm fires or a rights
  request cannot be processed.

For the *initial* go-live (the very first production deploy), see
`scripts/deploy/production-checklist.sh` and §"Go-Live Checklist" in
[README.md](README.md). This runbook assumes that gate has already passed.

## DPO Handoff

The DPO is the accountable party for Ley 1581/2012 compliance. The
onboarding checklist below is mandatory whenever a new DPO takes over
(whether the previous one rotated out or the company is scaling to
multiple DPOs).

### Adding a new DPO user

The DPO authenticates to `/admin/dpo` via Cognito (user pool
`us-east-1_LItAcj2Aa`). They MUST be in the `dpo` group or the
middleware returns 403.

1. Create the Cognito user (operator action — IAM-gated):

   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id us-east-1_LItAcj2Aa \
     --username <new-dpo-email> \
     --user-attributes Name=email,Value=<new-dpo-email> Name=email_verified,Value=true \
     --temporary-password <generated-strong-password>
   ```

2. Add them to the `dpo` group:

   ```bash
   aws cognito-idp admin-add-user-to-group \
     --user-pool-id us-east-1_LItAcj2Aa \
     --username <new-dpo-email> \
     --group-name dpo
   ```

3. Update the `PTD_DPO_EMAIL` SST Secret so SES alert emails go to the
   new DPO:

   ```bash
   sst secret set DpoEmail "<new-dpo-email>"
   npx sst deploy --stage prod
   ```

4. If the old DPO should keep receiving copies (transition window),
   append their address to `DPO_EMAILS` (env var in `sst.config.ts`):

   ```bash
   # In sst.config.ts, the SLA monitor / RNBD window / complaint
   # report functions all read DPO_EMAILS from process.env. Update
   # the env var + redeploy.
   DPO_EMAILS="<new-dpo-email>,<old-dpo-email>" npx sst deploy --stage prod
   ```

5. Notify the new DPO with the onboarding link (`https://market.opitacode.com/admin/dpo`)
   and a temporary password reset link from Cognito.

### Removing a DPO

```bash
# 1. Remove from the 'dpo' group (revokes /admin/dpo access).
aws cognito-idp admin-remove-user-from-group \
  --user-pool-id us-east-1_LItAcj2Aa \
  --username <old-dpo-email> \
  --group-name dpo

# 2. Disable the account (do NOT delete — preserves the audit trail
#    linking historical DPO actions to this user).
aws cognito-idp admin-disable-user \
  --user-pool-id us-east-1_LItAcj2Aa \
  --username <old-dpo-email>
```

### Rotating `ComplianceJwtSecret`

The `ComplianceJwtSecret` SST Secret is shared between `opita-market`
(this repo) and `opita-account-ui`. Both sides sign + verify HS256
JWTs with it via `jose`. The two values MUST match — if they diverge,
every cross-product session fails (users get bounced at `/admin/dpo`
with 401).

Rotation without downtime:

1. Coordinate with the `opita-account-ui` maintainer. Both deploys must
   happen within a 15-minute window so old JWTs issued by either side
   stay valid long enough for users in flight.
2. Generate a new 32+ byte secret:

   ```bash
   openssl rand -base64 48
   ```

3. Update `opita-account-ui`'s `JWT_SECRET` to the new value and deploy.
4. Update `opita-market`'s SST Secret and deploy:

   ```bash
   sst secret set ComplianceJwtSecret "<new-secret>"
   npx sst deploy --stage prod
   ```

5. Smoke test:

   ```bash
   PLAYWRIGHT_BASE_URL=https://market.opitacode.com \
     npx playwright test e2e/prod-smoke.spec.ts
   ```

If the smoke test fails with 401 on `/admin/dpo`, the two sides
drifted — re-check the `opita-account-ui` deployment immediately.

## Annual Compliance Ops

### RNBD Annual Update (2 January – 31 March)

Per Ley 1581/2012 Art. 25 + Decreto 1377/2013 Art. 43, the RNBD
registration must be updated annually during the 2 Jan – 31 Mar
window. The `RnbdWindowAlert` cron fires on the 1st of each month
during this window as a reminder.

1. Run the prereqs check:

   ```bash
   bash scripts/rnbd/verify-prerequisites.sh
   ```

   If any check fails, fix before continuing (e.g. SST Secret drift).

2. Re-generate the form payload (in case the SST Secrets changed since
   last year):

   ```bash
   bash scripts/rnbd/generate-form-payload.sh
   ```

3. Open the SIC portal:
   <https://www.sic.gov.co/registro-nacional-de-bases-de-datos>

4. Authenticate with the operator's certificado digital.

5. Update any fields that changed (razón social, dirección,
   representante legal, etc.). If nothing changed, attest "sin
   cambios" (no changes).

6. Save the SIC receipt PDF locally:

   ```
   scripts/rnbd/receipts/<date>-rnbd-annual-update.pdf
   ```

7. Upload to the immutable S3 bucket:

   ```bash
   bash scripts/rnbd/upload-receipt.sh \
     scripts/rnbd/receipts/<date>-rnbd-annual-update.pdf
   ```

   The script applies Object Lock COMPLIANCE mode + 7-year retention.
   Even the AWS root account cannot delete the receipt.

8. The local PDF can be deleted once the upload confirms.

### Complaint Report Auto-Draft (24 Feb, 24 Aug)

Per Circular Única SIC, the DPO must submit a semiannual complaint
report (H1: 1 Jan – 30 Jun by 24 Aug; H2: 1 Jul – 31 Dec by 24 Feb).
The `ComplaintReport` cron auto-drafts the report 24 hours before the
deadline and writes the markdown to:

- `s3://opita-market-prod-auditarchive/complaint-reports/h1-<year>.md`
- `s3://opita-market-prod-auditarchive/complaint-reports/h2-<year>.md`

The DPO reviews + signs off before submitting to SIC.

1. Wait for the SES email alert (sent to `DPO_EMAILS`) on 24 Feb / 24 Aug.
2. Pull the draft:

   ```bash
   aws s3 cp s3://opita-market-prod-auditarchive/complaint-reports/h1-2026.md ./
   ```

3. Open in your editor of choice. Verify the `derechos_del_titular`
   section matches the audit log (`audit_log` table → `action` =
   `rights_*`). Cross-reference with the SLA monitor's `SLA_Breaches`
   CloudWatch metric for the half.

4. If corrections are needed, fix them in the markdown and re-upload
   to the same S3 key (versioning preserves the original draft).

5. Submit to SIC via the portal. Save the SIC submission receipt to
   `scripts/rnbd/receipts/<date>-complaint-report-<period>.pdf` and
   run `scripts/rnbd/upload-receipt.sh` on it (Object Lock applies).

### Colombian Holidays List Maintenance

File: `packages/compliance-service/src/lib/colombian-holidays.ts`

This file drives the 15-business-day SLA math (Ley 1581 Art. 15). It
must be updated annually with the next year's official holidays (Law
emiliani de 1983 — always moved to Monday).

1. Source the official list: <https://www.festivos.com.co> or
   Ministerio del Interior calendar.
2. Add the new year's dates as immutable-pushed holidays (no DST
   in Colombia — UTC-5 year-round).
3. Update the unit test snapshot in
   `packages/compliance-service/src/tests/`.
4. PR → `legal-review` workflow → DPO + legal counsel approval →
   merge.

Law: Colombia has not observed DST since 1993 (UTC-5 year-round). Do
NOT add DST transitions to the holidays list — that would corrupt the
business-day calculations.

## Daily Operations

### SLA Monitor Cron

Runs 06:00 Colombia (11:00 UTC) daily via `SlaMonitorCron`. Reads
the `rights_requests` table + the `audit_log` table, computes which
open requests have exceeded the 15-business-day SLA, and:

- Emits a `SLA_Breaches` CloudWatch metric.
- Sends an SES email to `DPO_EMAILS` if the breach count is non-zero.
- Triggers the `SlaBreachesAlarm` CloudWatch Alarm → SNS → SES email.

Check the CloudWatch dashboard:

- `SLA_Breaches` metric — should be 0 most days.
- `RnbdWindowOpen` metric — 1 during Jan-Mar, 0 otherwise.
- Email alerts to DPO via SES — every breach produces exactly one email.

If `SLA_Breaches` is non-zero:

1. Pull the open requests past SLA from `rights_requests` (`SELECT *
   FROM representative_consented.rights_requests WHERE status =
   'open' AND created_at < now() - interval '15 business days'`).
2. For each: process the request (know / update / rectify / suppress)
   and update the row.
3. Reply to the titular within the 15-business-day window (or document
   the legal extension per Art. 16).

### CloudWatch Alarms

Three alarms wired in `sst.config.ts` to the `DpoAlerts` SNS topic:

| Alarm | Metric | Threshold | Snooze |
| ----- | ------ | --------- | ------ |
| `SlaBreachesAlarm` | SLA monitor Lambda Invocations > 0/day | 0 | 1 hour |
| `ComplaintReportAlarm` | Complaint report Lambda Errors > 0/day | 0 | 1 hour |
| `RnbdWindowAlarm` | RNBD window Lambda Invocations > 0/day | 0 | 1 hour |

SNS topic → SES email subscription (configured via `DPO_EMAIL_SUBSCRIBER`
env var). If the DPO stops receiving alarms:

1. Confirm SNS topic still exists: `aws sns list-topics`.
2. Confirm SES email subscription is still confirmed (initial setup
   requires the DPO click a confirmation link in an SES welcome email).
3. Re-send the confirmation if needed:

   ```bash
   aws sns confirm-subscription \
     --topic-arn <DpoAlertsTopicArn> \
     --token <token-from-welcome-email>
   ```

## Incident Response

### Severity 1 — Personal data breach exposed externally

Ley 1581/2012 Art. 17 requires notification to the SIC + affected
titulares within a "reasonable plazo" (commonly interpreted as
≤ 15 business days, mirroring the Art. 15 rights-response SLA).

1. **Contain** — Take the affected endpoint offline (e.g. disable the
   Lambda function: `aws lambda update-function-configuration
   --function-name opita-market-prod-ComplianceAPI --no-handler`).
2. **Investigate** — Pull the audit log: `SELECT * FROM
   public.audit_log WHERE ts > '<incident-window>' ORDER BY ts`.
3. **Notify** — Send breach notification to:
   - SIC via the portal (Art. 17).
   - Affected titulares via SES (template in
     `packages/compliance-service/src/lib/ses-alerts.ts`).
   - DPO + operator via the standard SES alert path.
4. **Document** — Append an immutable entry to the `audit_log` table
   describing the incident + remediation timeline.
5. **Review** — File a post-mortem within 5 business days. The DPO
   signs off on the post-mortem before resuming operations.

### Severity 2 — SLA breach accumulation (> 5 open > 15 business days)

1. Pull the open breaches from `rights_requests`.
2. Triage each by `request_type` — `suppress` requests take priority
   (Ley 1581 Art. 15 explicit deadline).
3. Process each request manually if the automated flow cannot resolve
   it (e.g. Verifik outage).
4. Document the delay + reason in the audit log.
5. Reply to each titular with an update + expected resolution date.

### Severity 3 — SES / Cognito / Aurora outage

Standard AWS incident response:

- Cognito outage → users cannot authenticate. `/admin/dpo` returns
  401 across the board. Wait for AWS recovery. Notify the DPO via
  the alternate channel (phone) if outage exceeds 4 hours.
- SES outage → compliance cron alerts do not send. The CloudWatch
  metric still emits — check the dashboard directly. Once SES
  recovers, the alarms re-fire on the next cron run.
- Aurora outage → Compliance API returns 503. `/market/rights/*` and
  `/market/verify-nit/*` fail. The NitDvCache (DynamoDB) carries the
  last 24h of lookups so we degrade to "no new verifications" until
  Aurora recovers.

For each: log the incident in `audit_log` with
`action='infra_outage'`.

## Tier Down / Outage Procedures

_To be filled in post-MVP when production traffic patterns are known._
_Priorities: graceful Lambda drain, RDS failover, CloudFront cache
warmup, Cognito user impact assessment._

## Change Log

- **2026-06-26** — Initial runbook (compliance-foundation PR 5).
- _Future PRs append here._