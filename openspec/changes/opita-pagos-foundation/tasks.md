# Tasks: opita-pagos-foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,000-3,500 |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Suggested split | 8 chained PRs (stacked to main) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

### Suggested Work Units

| PR | Goal | Scope | Stack target |
|----|------|-------|--------------|
| PR 1 | Foundation: types + errors + money + tiers | Package scaffold, types, money math, tier definitions + tests | main |
| PR 2 | Ledger + Wompi client | Append-only ledger, optimistic concurrency, Wompi signature + webhook verify | main |
| PR 3 | IP geo + Fraud engine | IP-API.com + IP2Proxy loaders, 12-signal fraud engine + decision matrix | main |
| PR 4 | Bonus engine + Referrals | 20 bonus rules config, referral code gen, qualification flow | main |
| PR 5 | Escrow + Crons | Escrow state machine, 6 cron handlers (reconciliation, streak, tor, uiaf, maxmind, ip2proxy) | main |
| PR 6 | Hono routes + sst.config.ts | 12 endpoints, 7 DynamoDB tables in SST, Router route | main |
| PR 7 | Frontend React islands | MarketCheckoutModal + WalletWidget + TierBadge + ReferralCodeCard | main |
| PR 8 | E2E + Deploy verification | Playwright e2e, deploy to dev, smoke test, DPO sign-off | main |

---

## Phase 1: Foundation (PR 1)

- [ ] 1.1 Scaffold `packages/pagos-service/` — package.json (deps: hono, @aws-sdk/*, jose, @maxmind/geoip2-node, ip2proxy-nodejs), tsconfig.json, vitest.config.ts with 90% coverage gate
- [ ] 1.2 Update root `package.json` to include `@opita-market/pagos-service` workspace
- [ ] 1.3 Create `src/lib/errors.ts` — typed errors (`TierLimitExceededError`, `WithdrawHoldNotElapsedError`, `FraudBlockedError`, `IdempotencyKeyReusedError`, etc.)
- [ ] 1.4 RED: Write `tests/unit/money.test.ts` — integer-only math, overflow, zero, negative
- [ ] 1.5 GREEN: Create `src/lib/money.ts` — `add`, `subtract`, `isPositive`, `formatCop`
- [ ] 1.6 RED: Write `tests/unit/tiers.test.ts` — tier definitions, limits, promotion logic, 3DS thresholds
- [ ] 1.7 GREEN: Create `src/lib/tiers.ts` — `TIERS` config (already drafted in design), `canPromoteTo`, `withdrawHoldFor`, `requires3DS`
- [ ] 1.8 Create `src/db/tables.ts` — type bindings (already drafted in design)
- [ ] 1.9 Verify PR 1: `npm run typecheck && npm run test && npm run lint` pass; coverage ≥90%

## Phase 2: Ledger + Wompi (PR 2)

- [ ] 2.1 RED: Write `tests/unit/wompi-signature.test.ts` — SHA256 integrity signature generation matches Wompi spec
- [ ] 2.2 RED: Write `tests/unit/wompi-webhook-verify.test.ts` — HMAC SHA256 verify with `timingSafeEqual`, reject mismatched signatures
- [ ] 2.3 GREEN: Create `src/lib/wompi.ts` — `generateIntegritySignature`, `verifyWebhookSignature`, `WompiClient` with sandbox URL
- [ ] 2.4 RED: Write `tests/unit/ledger.test.ts` — append-only semantics, balance projection, optimistic concurrency version bumps
- [ ] 2.5 GREEN: Create `src/lib/ledger.ts` — `appendLedgerEntry`, `getBalance`, `creditWallet`, `debitWallet` with conditional writes
- [ ] 2.6 RED: Write `tests/integration/ledger-concurrency.test.ts` — 100 concurrent ops, balance invariant, no lost updates
- [ ] 2.7 GREEN: Wire ledger.ts to DynamoDB client with `ConditionExpression` on `version`
- [ ] 2.8 Verify PR 2: typecheck + tests + integration test pass; Wompi signature matches Wompi doc examples

## Phase 3: IP Geo + Fraud Engine (PR 3)

- [ ] 3.1 RED: Write `tests/unit/ip-geolocation.test.ts` — lookup chain order, cache hit returns instantly, Tor flag from list, datacenter from IP2Proxy
- [ ] 3.2 GREEN: Create `src/lib/ip-geolocation.ts` — lookup chain (cache → IP-API.com → IP2Proxy → RIPEstat → Tor list)
- [ ] 3.3 RED: Write `tests/unit/ip2proxy-loader.test.ts` — load .bin from Lambda Layer path, lookup by IP, parse proxy_type
- [ ] 3.4 GREEN: Create `src/lib/ip2proxy-loader.ts` — lazy load `IP2Proxy-PX2.BIN` from `/opt/data/`
- [ ] 3.5 RED: Write `tests/unit/fraud-engine.test.ts` — 12 signal types, weighted decision matrix (BLOCK ≥0.7, REVIEW 0.4-0.7, ALLOW <0.4)
- [ ] 3.6 GREEN: Create `src/lib/fraud.ts` — `evaluateSignals(userId, ip, deviceId, amount) → {decision, signals}`
- [ ] 3.7 Create `scripts/download-geoip-databases.ts` — one-time setup to fetch IP2Proxy PX2 .bin into `packages/pagos-service/layer/`
- [ ] 3.8 Verify PR 3: typecheck + tests pass; lookup chain returns expected values for known test IPs (e.g., 8.8.8.8 = US, 1.1.1.1 = US)

## Phase 4: Bonus + Referrals (PR 4)

- [ ] 4.1 Create `src/lib/bonus-rules.ts` — 20 typed rules (WELCOME_CELL_VERIFIED, PURCHASE_CASHBACK, STREAK_*, REFERRAL_*, etc.) with amount, cooldown, multiplier
- [ ] 4.2 RED: Write `tests/unit/bonus-engine.test.ts` — each of 20 rules fires correctly, cooldowns enforced, chargeback reversal
- [ ] 4.3 GREEN: Create `src/lib/bonuses.ts` — `triggerRule(userId, ruleId, context) → {applied, amount}`, cooldown enforcement, chargeback reversal hook
- [ ] 4.4 RED: Write `tests/integration/bonus-on-purchase.test.ts` — full purchase webhook → bonus credited to buyer
- [ ] 4.5 RED: Write `tests/unit/referrals.test.ts` — code generation, validation, qualification triggers, anti-fraud (self/IP/device dup)
- [ ] 4.6 GREEN: Create `src/lib/referrals.ts` — `generateCode`, `acceptCode`, `qualifyOnAction`, with anti-fraud integration
- [ ] 4.7 Verify PR 4: typecheck + tests pass; bonus engine respects cooldowns; referrals block self-referral

## Phase 5: Escrow + Crons (PR 5)

- [ ] 5.1 RED: Write `tests/unit/escrow-state-machine.test.ts` — HELD → RELEASED on delivery, DISPUTED via dispute endpoint, REFUNDED on chargeback
- [ ] 5.2 GREEN: Create `src/lib/escrow.ts` — state transitions with invariant checks, evidence requirements for >$1M COP
- [ ] 5.3 RED: Write `tests/unit/reconciliation.test.ts` — DynamoDB ledger vs Wompi webhook log, detects missing webhooks
- [ ] 5.4 GREEN: Create `crons/reconciliation.ts` — daily 03:00 COL, scans `MarketTransactions` last 24h, queries Wompi API, alerts on discordance
- [ ] 5.5 GREEN: Create `crons/streak-evaluator.ts` — daily 00:00 COL, fires STREAK_7_DAYS / STREAK_30_DAYS
- [ ] 5.6 GREEN: Create `crons/tor-refresh.ts` — daily 04:00 COL, refreshes Tor exit list cache
- [ ] 5.7 GREEN: Create `crons/uiaf-monitor.ts` — hourly, detects users exceeding $5M COP daily, emits alert
- [ ] 5.8 Verify PR 5: typecheck + tests pass; reconciliation catches simulated discordance; cron schedules valid

## Phase 6: Hono Routes + SST (PR 6)

- [ ] 6.1 RED: Write `tests/integration/payment-orchestration.test.ts` — full intent → webhook → ledger flow, idempotency replay, concurrency
- [ ] 6.2 RED: Write `tests/integration/wallet-lifecycle.test.ts` — wallet auto-create, balance query, topup, withdraw, transfer
- [ ] 6.3 RED: Write `tests/integration/escrow-flow.test.ts` — full HELD → RELEASED with delivery webhook
- [ ] 6.4 RED: Write `tests/integration/chargeback-reversal.test.ts` — chargeback webhook auto-reverses tx + bonuses
- [ ] 6.5 RED: Write `tests/integration/referral-flow.test.ts` — signup → qualify → bonus payout
- [ ] 6.6 GREEN: Create `src/api/payments.ts` — `/v1/payments/intent`, `/webhook`, `/{id}/refund`, `/{id}/dispute`
- [ ] 6.7 GREEN: Create `src/api/wallet.ts` — `/v1/wallet/{u}/balance`, `/topup`, `/withdraw`, `/transfer`
- [ ] 6.8 GREEN: Create `src/api/tier.ts`, `bonuses.ts`, `referrals.ts`, `delivery.ts`, `emergency.ts`
- [ ] 6.9 GREEN: Create `src/api/index.ts` — Hono app factory + `hono/aws-lambda` `handle()` wrapper
- [ ] 6.10 GREEN: Create `src/index.ts` — Lambda entry: `export const handler = handle(app)`
- [ ] 6.11 Update `sst.config.ts` — 7 DynamoDB tables (MarketWallets, MarketLedger, MarketTransactions, MarketReferrals, MarketBonuses, IpGeoCache, FraudSignals) + `PagosAPI` Lambda + `GeoIpLayer` + Router route `/pagos/*`
- [ ] 6.12 Update `apps/market-web/.env.local` with sandbox Wompi keys (already done)
- [ ] 6.13 Verify PR 6: full `sst dev` deploy, all integration tests pass, smoke test against deployed Lambda

## Phase 7: Frontend (PR 7)

- [ ] 7.1 RED: Write `apps/market-web/src/components/market/MarketCheckoutModal.test.tsx` — widget injection, props, callbacks
- [ ] 7.2 GREEN: Create `src/components/market/MarketCheckoutModal.tsx` — React island, injects `<script src=checkout.wompi.co/widget.js>` with signature
- [ ] 7.3 RED: Write `src/components/market/WalletWidget.test.tsx` — balance display, withdraw button
- [ ] 7.4 GREEN: Create `src/components/market/WalletWidget.tsx` — React island, polls `/v1/wallet/{u}/balance`
- [ ] 7.5 RED: Write `src/components/market/TierBadge.test.tsx` — renders correct badge for each tier
- [ ] 7.6 GREEN: Create `src/components/market/TierBadge.tsx` — maps tier → badge color/icon
- [ ] 7.7 GREEN: Create `src/components/market/ReferralCodeCard.tsx` — displays user's code, copy-to-clipboard
- [ ] 7.8 GREEN: Create `apps/market-web/src/lib/wompi-widget.ts` — typed wrapper for Wompi widget injection
- [ ] 7.9 GREEN: Create `apps/market-web/src/lib/api-client.ts` — typed fetch wrapper for PagosAPI
- [ ] 7.10 Verify PR 7: components render in `npm run dev`, hot reload works

## Phase 8: E2E + Deploy (PR 8)

- [ ] 8.1 RED: Write `apps/market-web/e2e/checkout-flow.spec.ts` — full Playwright flow: login → buy product → webhook fires → wallet credited
- [ ] 8.2 RED: Write `apps/market-web/e2e/payout-flow.spec.ts` — seller withdraw to Bre-B (sandbox simulated)
- [ ] 8.3 GREEN: Wire E2E to use `DEV_MOCK_AUTH=true` with `x-dev-user` header
- [ ] 8.4 Deploy to dev stage: `npx sst deploy --stage dev`
- [ ] 8.5 Smoke test: `curl https://...lambda-url.../health` returns 200; Wompi sandbox test transaction succeeds
- [ ] 8.6 Manual review: DPO verifies 10 real (sandbox) transactions, signs off
- [ ] 8.7 Update `RUNBOOK.md` with payment deploy playbook + key rotation procedure
- [ ] 8.8 Update `apps/market-web/.gitignore` to confirm `.env` not committed
- [ ] 8.9 Verify PR 8: All spec scenarios mapped to tests with verdict COMPLIANT via `sdd-verify`

---

## Cross-cutting (every PR)

- [ ] All commits include typecheck + tests passing (`npm run typecheck && npm test`)
- [ ] No float arithmetic on money
- [ ] No PII in logs (emails + IPs hashed)
- [ ] No secrets in code (only via SST Secret)
- [ ] Dark-mem observation saved per major decision (link to change topic key)