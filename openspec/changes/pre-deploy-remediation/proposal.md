# Proposal: pre-deploy-remediation

## Intent

Address the 22 production-blockers and 5 compliance blockers found in the pre-deploy pentest (OPL-PT-2026-06-26-001). Fix by introducing 3 reusable gateway layers (Auth, Webhook, Transact) and hardening 6 existing capabilities, rather than 22 individual patches.

## Scope

### In Scope
- 3 new architectural gateways: Auth Gateway, Webhook Gateway, Transact Wrapper
- Hardening of 6 existing capabilities (anti-fraud-engine, bonus-engine, referrals-engine, anti-chargeback-escrow, wallet-lifecycle, payment-orchestration)
- UIAF/PEP/Sanctions compliance wiring (external service integration)
- 4 PRs chained to main, each TDD-strict with ≥90% coverage

### Out of Scope
- Dynamic Lambda probing (deferred to PR 8 of opita-pagos-foundation)
- External auditor engagement (recommended for prod, not in scope here)
- Refactor of compliance-service (separate change)

## Capabilities

### New Capabilities
- `auth-gateway`: Centralized JWT verification + RBAC + IP allowlist + dev-bypass via explicit flag
- `webhook-gateway`: Wompi webhook signature + timestamp + replay window + idempotency + 3DS verification
- `transact-wrapper`: DynamoDB TransactWriteItems wrapper for atomic multi-item operations
- `velocity-counter`: Per-BIN/IP/device/email velocity tracking with TTL-based cleanup
- `compliance-engine`: UIAF SAR filing + PEP screening + OFAC/UN/EU sanctions screening
- `secrets-config`: All secrets via SST Secret; all env vars typed at compile time
- `frontend-bundle-security`: SRI for third-party scripts, CSRF tokens, CSP headers
- `observability`: CloudWatch alarms, WAF rules, Lambda reserved concurrency, structured logging

### Modified Capabilities
- `payment-orchestration`: Webhook full state machine + idempotency + 3DS verification
- `wallet-lifecycle`: Atomic P2P transfer via TransactWriteItems + remove TOCTOU
- `anti-fraud-engine`: Velocity signals + user history + normalize formula
- `bonus-engine`: Atomic claim + per-user cap + remove clock injection
- `referrals-engine`: Per-user monthly cap + required anti-fraud context
- `anti-chargeback-escrow`: SSRF validation in evidence photo_url

## Approach

9 architectural themes mapped to 4 PRs (TDD strict, chained to main). Each PR delivers one reusable gateway + integrates it into 2-4 existing capabilities. 12 ADRs in `design.md`. Compliance wiring runs in parallel with external legal counsel.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/pagos-service/src/lib/auth/` | Modified | Centralized gateway replacing per-endpoint checks |
| `packages/pagos-service/src/lib/webhook-gateway/` | New | New module: verify + idempotency + state machine |
| `packages/pagos-service/src/lib/transact/` | New | New wrapper around TransactWriteItems |
| `packages/pagos-service/src/lib/velocity/` | New | New module: counter + cache + signal generation |
| `packages/pagos-service/src/lib/fraud.ts` | Modified | Integrate velocity signals + normalize |
| `packages/pagos-service/src/lib/bonus-rules.ts` | Modified | Per-user daily cap + atomic claim |
| `packages/pagos-service/src/lib/escrow.ts` | Modified | SSRF validation in photo_url |
| `packages/pagos-service/crons/uiaf-monitor.ts` | Modified | Wire to EventBridge + SAR filing |
| `packages/pagos-service/src/api/*` | Modified | Replace per-endpoint auth with authGateway |
| `sst.config.ts` | Modified | Add 4 SST Secrets + CloudWatch alarms + WAF + reserved concurrency |
| `apps/market-web/src/lib/auth/` | Modified | Same pattern as backend auth-gateway |
| `apps/market-web/src/middleware.ts` | Modified | CSP + security headers |
| `apps/market-web/src/lib/wompi-widget.ts` | Modified | Add SRI + crossOrigin |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TransactWriteItems changes ledger semantics | Med | TDD: 6 atomicity tests before integration; rollback plan via feature flag |
| Compliance external services block on vendor | High | Provider selected (ComplyAdvantage, OFAC API); service account created; fall-back to manual review if unavailable |
| Auth gateway changes break existing 311 tests | Med | Run full test suite per PR; isolate changes to new module first |
| Webhook gateway delays Wompi callbacks | Low | Idempotency check in <10ms via DynamoDB GSI; tested at 1000 RPS |

## Rollback Plan

Each PR is independently revertible. PR 1 introduces 3 new modules with feature flags (`AUTH_GATEWAY_ENABLED`, `WEBHOOK_GATEWAY_ENABLED`, `TRANSACT_ENABLED`). If a PR causes regressions, disable the flag and revert the PR. No data migrations required.

## Dependencies

- AWS Secrets Manager (already used)
- ComplyAdvantage or equivalent (PEP/sanctions) — provider selection pending
- Wompi API (already integrated)
- DynamoDB (already provisioned)

## Success Criteria

- [ ] All 22 production-blockers closed (tracked in remediation-checklist.md)
- [ ] All 5 compliance blockers closed (regulatory)
- [ ] Test coverage ≥ 90% maintained (lines, branches, functions)
- [ ] Zero regressions in existing 311 tests
- [ ] Re-pentest (focal) shows 0 new findings of the same class
- [ ] Wompi sandbox end-to-end test passes (full payment flow)
- [ ] Internal smoke test against dev Lambda passes
