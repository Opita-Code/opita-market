# Proposal: opita-pagos-foundation

## Intent

Process **real money** for Opita Market — a production-grade, multi-channel payment orchestration layer that lets Colombian vendors (especially rural Huila businesses) receive payments via Bre-B and cards **without needing their own merchant account or credit card**, hold funds in a COP-pegged closed-loop wallet, withdraw to Bre-B instantly, and earn engagement bonuses through a transparent, audit-friendly virtual currency system. This is **the definitive version** — no MVP shortcuts, no "production TODOs". Bugs = lost money, regulatory fines, or UIAF sanctions. SDD + TDD + rigorous testing is non-negotiable.

## Scope

### In Scope (this change)
- New `packages/pagos-service/` (parallel to `compliance-service`, not extending it) — Hono Lambda + DynamoDB single-region tables + Lambda Layer with MaxMind GeoLite2 + IP2Proxy LITE.
- 7 DynamoDB tables: `MarketWallets`, `MarketLedger` (append-only), `MarketTransactions`, `MarketReferrals`, `MarketBonuses`, `IpGeoCache` (TTL 7d), `FraudSignals` (TTL 30d).
- `PagosAPI` Lambda with endpoints: `/v1/payments/intent`, `/v1/payments/{id}/status`, `/v1/payments/{id}/refund`, `/v1/wallet/{u}/balance`, `/v1/wallet/{u}/topup`, `/v1/wallet/{u}/withdraw`, `/v1/wallet/{u}/transfer`, `/v1/tier/{u}`, `/v1/bonuses/{u}/balance`, `/v1/referrals/create`.
- Wompi client: checkout-sign generator (SHA256 integrity signature), webhook validator (HMAC SHA256 with timing-safe-equal), idempotency-key dedup.
- Anti-fraude engine: 12 signal types (velocity, geo mismatch, Tor/VPN/proxy/datacenter detection, blacklist, device fingerprint, etc.) with weights and ALLOW/REVIEW/BLOCK decisions.
- Tier system (0-4) with rural-aware limits: Tier 2 = $20M COP receive/day (covers cattle/harvest sales); Tier 4 = $500M COP receive/day (cooperatives).
- Bonus engine (20 rules, configurable, cooldowns, anti-fraud-aware).
- Anti-chargeback escrow: 3DS mandatory thresholds per tier, T+72h dispute window, evidence-of-delivery requirement, hold on card payments until transportadora confirms delivery, **instant release for Bre-B** (A2A is irreversible by design).
- IP geolocation lookup chain: DynamoDB cache → MaxMind GeoLite2 (self-hosted in Lambda Layer) → IP2Proxy LITE (self-hosted) → RIPEstat (existing `dark-recon`) → AbuseIPDB free tier (only when flagged).
- Reuses `@opita-market/compliance-service` for: Verifik client (NIT+DV), Cognito 3-tier auth fallback, audit_log ingestion for payment events.
- Audit log: every payment movement written to `representative_consented.audit_log` (existing) — append-only, 5y retention, ships to S3 at year 5.
- Daily reconciliation cron: compares DynamoDB ledger vs Wompi webhook log, alerts on discordance.

### Out of Scope (deferred to follow-up changes)
- Multi-currency (USD, BRL) — COP only for now.
- Crypto onramps / stablecoin wallet.
- Mercado Pago / PayU / Wompi competitors — single-processor dependency.
- Full logistics integration (Interrapidisimo API) — for this change, escrow just holds funds and we wire transportadora confirmation via signed webhook (signature validator in spec, integrator in next change).
- Public API for partners / "Pay with Opita" embeddable widget.
- Multi-currency FX conversion.

## Capabilities

### New Capabilities
- `payment-orchestration`: Wompi intent creation, idempotency, webhook validation, transaction state machine (PENDING → APPROVED | DECLINED | ERROR | REFUNDED).
- `wallet-lifecycle`: COP-pegged closed-loop wallet (Tier 0-4 limits, T+Xh withdrawal holds, ledger append-only).
- `tier-system`: KYC-tiered limits with promotion rules; trust badges surfaced to counterparties.
- `anti-fraud-engine`: 12 signal types, weighted scoring, ALLOW/REVIEW/BLOCK decisions, blacklist integration.
- `bonus-engine`: 20 configurable rules with cooldowns, multiplier support, fraud-aware (no bonus for chargebacked tx).
- `anti-chargeback-escrow`: 3DS thresholds, evidence-of-delivery requirement, transportadora confirmation webhook, T+72h dispute window, Bre-B instant release.
- `ip-geolocation`: 6-source lookup chain (MaxMind + IP2Proxy self-hosted + RIPEstat + Tor list + AbuseIPDB + Team Cymru DNS fallback), $0/month, 7-day TTL cache.
- `referrals-engine`: 2-sided bonus (referrer + referee), QUALIFIED state requires first purchase, anti-fraud (self-referral blocked, IP duplicate check).

### Modified Capabilities
None — first change to introduce payments. Future changes will extend compliance-foundation or data-segregation-model if needed.

## Approach

Build a **separate Lambda** (`PagosAPI`) with **own DynamoDB tables** for clean separation from compliance-service. Reuse via npm workspace imports the things that are mature and shared: Verifik client, Cognito auth middleware, audit-log emitter. Self-host MaxMind GeoLite2 + IP2Proxy LITE as a Lambda Layer to keep cost at $0/month for IP geo (vs $5-50/month for paid APIs). Use Hono router + `hono/aws-lambda` `handle()` wrapper (lesson learned from compliance-service: `app.fetch(event)` crashes on Lambda Function URL events). Money handling is **integer-only** (COP has no decimals — 1 unit = 1 COP) — never float. Every state-changing op requires an `Idempotency-Key` header; dedup via DynamoDB conditional write with `attribute_not_exists(idempotency_key)`. Webhook handler is **dedup-by-wompi-tx-id** with a separate DynamoDB conditional write. Concurrency: all balance mutations use DynamoDB conditional updates with optimistic concurrency (`version` attribute + `version = :expected_version`). Reconciliation cron at 03:00 COL runs daily and writes any discordance to `FraudSignals` + alerts DPO via SES.

## Affected Areas

| Area | Impact | Description |
|------|--------|------------|
| `packages/pagos-service/` | **New** | New npm workspace package — the heart of Opita Pagos |
| `packages/pagos-service/src/api/` | **New** | Hono routes (`payments.ts`, `wallet.ts`, `tier.ts`, `bonuses.ts`, `referrals.ts`) |
| `packages/pagos-service/src/lib/` | **New** | Wompi client, anti-fraude engine, bonus engine, tier manager, ledger ops, IP geolocator |
| `packages/pagos-service/src/db/tables.ts` | **New** | DynamoDB table type bindings |
| `packages/pagos-service/src/db/schema.sql` | **New** | Postgres schema additions for payment audit (links to compliance audit_log) |
| `packages/pagos-service/tests/` | **New** | vitest unit + integration tests (testcontainers Postgres + localstack DynamoDB) |
| `packages/compliance-service/src/lib/verifik-client.ts` | Reuse | Imported via workspace — no changes |
| `packages/compliance-service/src/lib/cognito-auth.ts` | Reuse | Imported via workspace — refactor to a shared package first if needed |
| `packages/compliance-service/src/api/audit-log.ts` | Reuse | Imported to write payment events to `representative_consented.audit_log` |
| `apps/market-web/src/components/market/` | **New** | React island: `MarketCheckoutModal.tsx` + `WalletWidget.tsx` + `TierBadge.tsx` |
| `apps/market-web/src/lib/wompi-widget.ts` | **New** | Wompi widget script injection helper |
| `sst.config.ts` | Modified | Add `PagosAPI` Lambda, 7 DynamoDB tables, Lambda Layer (MaxMind + IP2Proxy), new SST Secrets |
| `openspec/config.yaml` | Modified | Set `strict_tdd: true`, configure vitest + testcontainers + 90% coverage gate |
| `.github/workflows/ci.yml` | Modified | Add unit + integration test jobs with coverage gate |
| `.github/workflows/deploy-backend.yml` | **New** | Path-filtered SST deploy for pagos-service |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Lost money due to race condition in balance updates** | High if not handled | Optimistic concurrency via DynamoDB conditional writes with `version` attribute + `ConditionExpression: version = :v`. TDD: race-condition tests with 100 concurrent ops |
| **Chargeback fraud on cards** | High in rural LATAM | 3DS mandatory thresholds, T+72h dispute window, evidence-of-delivery required, hold until transportadora confirms, **Bre-B is the recommended path** (irreversible A2A) |
| **Self-referral fraud (user invites themselves)** | Medium | Anti-fraud rule: same device fingerprint OR same IP cannot be both referrer and referee; one-way bonus only fires after first qualifying purchase |
| **Velocity bypass via multiple devices** | Medium | Velocity rule aggregates across (user_id, last_24h) regardless of device |
| **Bonus exploitation (referral loops)** | Medium | Cooldown per bonus rule (e.g., referral cooldown 7 days), anti-fraud reviews referrals every 24h |
| **IP geolocation inaccuracy (cell towers, CGNAT)** | Medium | Use MaxMind confidence score + declare city as "approximate"; don't hard-block on city mismatch — only flag for review |
| **UIAF threshold breach** (any tx >$5M COP) | High in rural | Auto-report at $5M/day accumulated; flag at $1M/day for review |
| **Operator's first mistake in production** | Inevitable | Daily reconciliation cron + Discordance alerts to DPO via SES + emergency kill-switch (`SST_API_PAUSED=true` env var disables payment intents) |
| **Lambda cold start on Wompi webhook** | Medium | Provisioned concurrency (1 always-warm) for `PagosAPI`; webhook path is short (<200ms typical) |
| **Secrets leak via SST** | Low | Use SST `Secret` (KMS-encrypted), never env vars, rotation every 90 days, audit access via CloudTrail |

## Rollback Plan

1. **Disable payment intents** via emergency env flag (`SST_API_PAUSED=true`) — instantly blocks new payments without deploy.
2. **Disable payouts** via `SST_PAYOUTS_PAUSED=true` — blocks Bre-B withdrawals.
3. **Refund in-flight tx**: Lambda has `/v1/payments/{id}/refund` admin endpoint (gated to DPO group in Cognito) — call Wompi refund API.
4. **Withdraw user balances**: if Wallet Ledger is correct, mass-payout script (`scripts/emergency/payout-all.ts`) drains all balances to original payment method via Wompi refund.
5. **SST remove**: `sst remove --stage prod` deletes all DynamoDB tables (after backup to S3). ComplianceService untouched.
6. **Frontend fallback**: Astro deploy without `MarketCheckoutModal.tsx` removes the pay button entirely (no orphaned UI).
7. **Communicate**: DPO sends email via SES to all active users about paused status.

## Dependencies

- **Wompi sandbox keys** (operator provides before `apply` phase reaches `/v1/payments/intent` endpoint task) — `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_WEBHOOK_SECRET`.
- **MaxMind GeoLite2** free license — operator must register at maxmind.com and provide `MAXMIND_LICENSE_KEY` (one-time, free).
- **IP2Proxy LITE PX2** free download — direct from `lite.ip2location.com` (no key, just download).
- **AbuseIPDB free tier** API key — operator registers (free, 1k checks/day cap).
- **Reuses**: `@opita-market/compliance-service` Verifik client + Cognito auth + audit log emitter (already shipped).
- **Transportadora integration** (Interrapidisimo first) — webhook signature contract defined in spec; actual transportadora integration deferred to follow-up change (just need signed POST `/v1/delivery/confirm` endpoint stubbed for now).

## Success Criteria

- [ ] **Zero critical bugs in production for 30 days post-launch** — measured by no Sev1 incidents, no balance discrepancies, no chargebacks from missing fraud signals.
- [ ] **All 6 spec files pass `sdd-verify`** with verdict COMPLIANT (zero FAILING, zero UNTESTED).
- [ ] **Test coverage ≥ 90%** for `packages/pagos-service/src/` (unit + integration via testcontainers).
- [ ] **All Wompi webhook paths idempotent** — replaying a webhook 10× produces exactly 1 ledger entry (verified by integration test).
- [ ] **Concurrent balance test**: 100 simultaneous top-ups + 100 simultaneous withdrawals on the same wallet — final balance = expected (no double-spend, no lost updates). TDD assertion.
- [ ] **Anti-fraude catches known patterns in unit tests**: 12 signal types each with a positive test (fraud detected) and negative test (legitimate user not flagged).
- [ ] **Reconciliation cron passes 7 days straight**: DynamoDB ledger matches Wompi webhook log every day for 7 days post-launch.
- [ ] **First 10 real transactions processed end-to-end** with DPO manually reviewing each one before they go to the holding window.
- [ ] **Cost**: IP geolocation = $0/month (verified by AWS bill showing $0 for the IP-related stack).
- [ ] **Latency**: `POST /v1/payments/intent` p95 < 400ms; `POST /webhook` p95 < 250ms (verified by CloudWatch metrics).
- [ ] **Operator sign-off**: DPO email confirms compliance checklist before any Tier 2+ customer receives their first payment.