# Spec: observability

## Purpose

Zero CloudWatch alarms, no WAF, no Lambda reserved concurrency, no structured logging. A production incident would not be detected until manual user complaint. This spec adds the operational foundations for safe production launch.

## Requirements

### R1 — CloudWatch alarms (7 mandatory)
- Lambda errors > 1% in 5 minutes → page
- Lambda throttles > 0 → page
- DynamoDB throttles > 0 → ticket
- API Gateway 5xx > 1% in 5 minutes → page
- **Webhook signature failures > 10/min** → page (security signal)
- **Fraud BLOCK rate > 50%/h** → page (potential attack)
- Failed login attempts > 100/min → page (credential stuffing)

### R2 — AWS WAF attached
- Web ACL attached to Lambda Function URL or API Gateway
- Rules:
  - Rate-based: 100 requests per 5 minutes per IP
  - AWS Managed Rules: Common Rule Set, Known Bad Inputs
  - SQL injection protection
  - XSS protection
  - Geographic restriction (allow Colombia + US Wompi IP ranges)

### R3 — Lambda reserved concurrency
- `pagos-api` Lambda: reserved concurrency = 10 (protects account limit)
- `uiaf-monitor` cron: reserved concurrency = 1 (one execution at a time)
- `reconciliation` cron: reserved concurrency = 1
- Total account usage: < 50 (well below 1000 limit)

### R4 — Structured JSON logging
- Lambda logs to JSON: `{ ts, level, msg, requestId, userId, latency_ms, error_code, ... }`
- No `console.log(string)` in production code
- All log lines have `level: 'info' | 'warn' | 'error' | 'debug'`
- Sensitive data: PII hashed (SHA-256[:16]), no full PAN, no full email

### R5 — X-Ray tracing
- Lambda X-Ray tracing enabled
- Service map: API Gateway → Lambda → DynamoDB
- 100% sampling for first 7 days, 10% after (cost control)

### R6 — DynamoDB auto-scaling + on-demand backup
- All tables: on-demand capacity mode (auto-scales)
- Daily backup: 7-day retention
- PITR (point-in-time recovery) enabled

### R7 — DLQ for failed webhooks
- Webhook handler failures → SQS DLQ
- DLQ retention: 14 days
- CloudWatch alarm on DLQ depth > 0
- Manual replay tool for DPO

## Scenarios

### S1 — Attack detected
- Attacker sends 1000 webhook signature failures in 1 minute
- CloudWatch alarm fires: `webhook_signature_failures > 10/min`
- DPO + on-call notified via SNS → PagerDuty
- **Expected**: Incident response within 15 minutes
- **Closes**: operational readiness

### S2 — DoS attempt
- Attacker sends 10,000 requests from 1 IP in 5 minutes
- WAF rate-based rule: 100 per 5 min, exceeded
- **Expected**: 403 from WAF, Lambda never invoked, account concurrency preserved
- **Closes**: OPL-IAM-005 (DoS protection)

### S3 — DynamoDB capacity spike
- Traffic surge: DynamoDB throttles 5 requests
- CloudWatch alarm: `dynamodb_throttles > 0`
- **Expected**: Ticket created, on-call investigates auto-scaling config
- **Closes**: operational visibility

### S4 — Failed login storm
- Credential stuffing: 1000 failed logins in 5 minutes
- CloudWatch alarm: `failed_logins > 100/min`
- **Expected**: Auto-block IP via WAF managed rule
- **Closes**: security incident response

### S5 — Webhook DLQ replay
- Wompi sends webhook, Lambda crashes mid-processing
- Event lands in DLQ
- DPO uses replay tool: `npx tsx scripts/replay-dlq.ts --event-id=evt-123`
- **Expected**: Event reprocessed successfully
- **Closes**: data loss prevention

## Out of Scope

- Real-time fraud dashboard (separate BI project)
- ML-based anomaly detection
- Multi-region failover (single region for v1)
- Cost optimization alarms (separate FinOps work)
