// @opita-market/compliance-service
//
// Ley 1581/2012 Habeas Data compliance service.
//
// Public API surface (implemented in PR 2 — feat/cf-pr2-*):
//   - api/rights.ts    — know / update / rectify / suppress workflows
//   - api/audit.ts     — audit log writes (immutable, append-only)
//   - api/nit-dv.ts    — Verifik API wrapper + 24h cache
//   - lib/sla-monitor.ts — daily cron (PR 4)
//   - lib/dpo-tools/   — RNBD window + semiannual complaint report (PR 4)
//
// Public API surface (this PR — feat/cf-pr1-*):
//   - db/schema.sql    — segregated Postgres schemas + audit_log + consent_tokens

export const COMPLIANCE_SERVICE_VERSION = "0.1.0";
export const COMPLIANCE_DATA_BOUNDARY_DRAFT = true;