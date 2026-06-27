# Tasks: pre-deploy-remediation

## Summary

4 PRs (chained to main) deliver 9 architectural themes. Each PR follows TDD strict (RED → GREEN → REFACTOR) with ≥90% coverage. Compliance work runs in parallel with operator.

## Work Unit Table

| # | Theme | PR | Files | Tests | Effort |
|---|---|---|---|---|---|
| 1 | Auth Gateway (new module) | PR 1.1 | 5 new, 0 mod | 12 | 1d |
| 2 | Webhook Gateway (new module) | PR 1.2 | 6 new, 0 mod | 15 | 1d |
| 3 | Transact wrapper (new module) | PR 1.3 | 5 new, 0 mod | 18 | 1d |
| 4 | Secrets + integration (8 API files) | PR 1.4 | 0 new, 9 mod | 6 | 1d |
| 5 | Velocity counter + fraud engine | PR 2.1 | 4 new, 2 mod | 14 | 1d |
| 6 | Bonus engine hardening | PR 2.2 | 0 new, 3 mod | 10 | 1d |
| 7 | Referral anti-fraud + cap | PR 2.3 | 0 new, 2 mod | 6 | 0.5d |
| 8 | Escrow SSRF + state machine | PR 2.4 | 0 new, 2 mod | 8 | 0.5d |
| 9 | Frontend bundle security | PR 3.1 | 1 new, 4 mod | 10 | 1d |
| 10 | WAF + observability | PR 3.2 | 0 new, 2 mod | 8 | 0.5d |
| 11 | Structured logging + X-Ray | PR 3.3 | 0 new, 2 mod | 4 | 0.5d |
| 12 | UIAF cron wiring | PR 4.1 | 0 new, 1 mod | 8 | 1d |
| 13 | PEP/Sanctions external service | PR 4.2 | 1 new, 0 mod | 6 | 2d |

**Total: 13 PRs (some grouped), 11 days work for 1 dev, 5-7 days for 2 devs.**

## PR 1 — Critical Blockers (3-4 days)

### PR 1.1 — Auth Gateway (TDD strict)

**RED (2h)**:
- [ ] Test: `authGateway` with valid JWT → returns AuthContext
- [ ] Test: `authGateway` with missing JWT → throws AuthError('UNAUTHENTICATED')
- [ ] Test: `authGateway` with wrong `aud` claim → throws AuthError('INVALID_AUDIENCE')
- [ ] Test: `authGateway` with wrong `iss` claim → throws AuthError('INVALID_ISSUER')
- [ ] Test: `authGateway` with expired JWT → throws AuthError('EXPIRED_TOKEN')
- [ ] Test: `authGateway` with `x-dev-user` and `DEV_AUTH_ENABLED=true` → activates dev-bypass
- [ ] Test: `authGateway` with `x-dev-user` and `DEV_AUTH_ENABLED` unset → throws AuthError('UNAUTHENTICATED')
- [ ] Test: `authGateway` with `x-dev-user` and `NODE_ENV=undefined` → throws AuthError('UNAUTHENTICATED')  ← closes OPL-LIB-005
- [ ] Test: `requireRole` with dpo group + role='dpo' → passes
- [ ] Test: `requireRole` with user group + role='dpo' → throws AuthError('FORBIDDEN')
- [ ] Test: rate limit: 61st request from same userId in 60s → throws RateLimitError
- [ ] Test: rate limit: 21st anonymous request from same IP in 60s → throws RateLimitError

**GREEN (4h)**:
- [ ] Implement `src/lib/auth/jwt.ts`: verify with aud + iss + exp checks
- [ ] Implement `src/lib/auth/rbac.ts`: ROLES, hasRole
- [ ] Implement `src/lib/auth/dev-bypass.ts`: isDevBypassEnabled using DEV_AUTH_ENABLED
- [ ] Implement `src/lib/auth/gateway.ts`: authGateway + requireRole + requireDpo
- [ ] Implement `src/lib/auth/rate-limit.ts`: Redis counter
- [ ] Add `src/lib/auth/index.ts` barrel export

**REFACTOR (1h)**:
- [ ] Extract shared JWT verification to `jwt.ts` (used by both backend + frontend)
- [ ] Add JSDoc comments
- [ ] Verify ≥90% coverage

**Acceptance**:
- All 12 tests pass
- 90%+ coverage in `auth/` directory
- No regressions in existing 311 tests
- `x-dev-user` with NODE_ENV=undefined → 401 (closes OPL-LIB-005)
- Wrong audience JWT → 401 (closes MW-FE-006)

---

### PR 1.2 — Webhook Gateway (TDD strict)

**RED (3h)**:
- [ ] Test: `verifySignature` with valid HMAC → no throw
- [ ] Test: `verifySignature` with invalid HMAC → throws InvalidSignatureError (no message)
- [ ] Test: `verifyTimestamp` with timestamp 1 hour ago → throws WebhookExpiredError
- [ ] Test: `verifyTimestamp` with timestamp now → no throw
- [ ] Test: `isReplay` with new event_id → false
- [ ] Test: `isReplay` with existing event_id → true
- [ ] Test: `processWompiWebhook` first call → processes, writes ProcessedWebhooks
- [ ] Test: `processWompiWebhook` second call same event_id → returns ok, no double processing
- [ ] Test: `handleApproved` with 3DS not verified → fraud signal, no credit
- [ ] Test: `handleApproved` with 3DS verified + escrow NONE → credit wallet
- [ ] Test: `handleDeclined` → marks tx FAILED
- [ ] Test: `handleReversed` → triggers bonus reversal
- [ ] Test: `processTransportadoraWebhook` with valid HMAC → processes
- [ ] Test: `processTransportadoraWebhook` with valid HMAC but wrong transportadora → 403
- [ ] Test: `processTransportadoraWebhook` with invalid HMAC → 401

**GREEN (5h)**:
- [ ] Implement `webhook-gateway/verify.ts`: signature + timestamp
- [ ] Implement `webhook-gateway/replay.ts`: idempotency
- [ ] Implement `webhook-gateway/pipeline.ts`: event dispatch
- [ ] Implement `webhook-gateway/state-machines/transaction.ts`: 4 handlers
- [ ] Implement `webhook-gateway/gateway.ts`: processWompiWebhook + processTransportadoraWebhook
- [ ] Update `ProcessedWebhooks` table in sst.config.ts
- [ ] Wire `sst.config.ts` to grant Lambda access to ProcessedWebhooks

**REFACTOR (1h)**:
- [ ] Extract common event parsing
- [ ] Add types for WompiEvent
- [ ] Verify ≥90% coverage

**Acceptance**:
- All 15 tests pass
- 90%+ coverage in `webhook-gateway/` directory
- Replay attack: same event_id twice → only 1 credit (closes OPL-LIB-001, OPL-API-004)
- Expired webhook (1h old) → 401 (closes OPL-LIB-001)
- 3DS required but not present → no credit, fraud signal (closes OPL-CARD-004)
- Transportadora auth check (closes OPL-API-002)

---

### PR 1.3 — Transact Wrapper (TDD strict)

**RED (3h)**:
- [ ] Test: `transactDebitWallet` with sufficient balance → success, balance decreased
- [ ] Test: `transactDebitWallet` with 0 balance → throws InsufficientBalanceError (no balance in msg)
- [ ] Test: `transactDebitWallet` with same idempotencyKey twice → returns cached result
- [ ] Test: `transactDebitWallet` with conflicting idempotencyKey + different amount → throws ConflictingIdempotencyError
- [ ] Test: `transactP2PTransfer` with sufficient balance → both balances updated atomically
- [ ] Test: `transactP2PTransfer` with credit leg fails (simulated) → both rollback
- [ ] Test: `transactP2PTransfer` 2 concurrent with full balance → only 1 succeeds
- [ ] Test: `transactEscrowTransition` HELD → RELEASED → ok
- [ ] Test: `transactEscrowTransition` HELD → REFUNDED (concurrent) → second throws STATE_CONFLICT
- [ ] Test: `transactBonusClaim` first time → bonus applied
- [ ] Test: `transactBonusClaim` second time same transactionId → throws BONUS_ALREADY_CLAIMED
- [ ] Test: `transactBonusClaim` 2 concurrent first-purchase → only 1 succeeds
- [ ] Test: `transact` with TransactionConflictException → retries 3x
- [ ] Test: `transact` with ConditionalCheckFailedException → no retry, throws
- [ ] Test: `transact` with max items (100) → success
- [ ] Test: `transact` with 101 items → throws TooManyItemsError
- [ ] Test: `transactP2PTransfer` with same user from→to → throws SelfTransferError
- [ ] Test: `transactP2PTransfer` with negative amount → throws InvalidAmountError

**GREEN (5h)**:
- [ ] Implement `transact/wrapper.ts`: transact<T> + retry logic
- [ ] Implement `transact/wallet.ts`: transactDebitWallet, transactCreditWallet, transactP2PTransfer
- [ ] Implement `transact/escrow.ts`: transactEscrowTransition
- [ ] Implement `transact/bonus.ts`: transactBonusClaim
- [ ] Implement `transact/errors.ts`: TransactError, ConditionFailedError, etc.

**REFACTOR (1h)**:
- [ ] Extract common idempotency condition
- [ ] Add result types
- [ ] Verify ≥90% coverage

**Acceptance**:
- All 18 tests pass
- 90%+ coverage in `transact/` directory
- P2P transfer: 2 concurrent with full balance → 1 succeeds, 1 fails (closes OPL-API-001, OPL-CARD-003)
- Debit: TOCTOU race eliminated (closes OPL-LIB-002)
- Debit error: no balance leak in message (closes OPL-LIB-006)
- Bonus claim: atomic, no double application (closes OPL-LIB-008, OPL-CARD-019)

---

### PR 1.4 — Secrets + Integration (TDD strict)

**RED (1h)**:
- [ ] Test: SST Secret WompiPrivateKey exists, value is not empty
- [ ] Test: Lambda handler reads Wompi keys from SST Secret, not env
- [ ] Test: Bundle build with no PUBLIC_ secrets in dist/

**GREEN (3h)**:
- [ ] Update `sst.config.ts`: add 4 SST Secrets (WompiPublic, WompiPrivate, WompiEvents, WompiIntegrity)
- [ ] Update `pagos-service/src/lib/wompi.ts`: read from SST Secret binding
- [ ] Update `.env`: remove Wompi prod keys (keep only sandbox test keys for dev)
- [ ] Update `sst.config.ts`: rotate Wompi prod key (operator action)
- [ ] Update `apps/market-web/src/lib/cognito-sso-consumer.ts`: read JWT_SECRET from runtime env
- [ ] Update `apps/market-web/src/lib/api-client.ts`: no PUBLIC_ prefix on JWT_SECRET
- [ ] Update `apps/market-web/src/lib/wompi-widget.ts`: read Wompi public key (the one allowed) at runtime
- [ ] Add CI step: `grep -rE 'PRIVATE|INTEGRITY|EVENTS_SECRET' apps/market-web/dist/` (must be empty)

**REFACTOR (1h)**:
- [ ] Add env var schema with zod
- [ ] Document rotation procedure in RUNBOOK.md
- [ ] Update sst.config.ts to grant Lambda access to secrets

**Acceptance**:
- All 6 tests pass
- Wompi keys in SST Secrets, not in .env (closes OPL-IAM-003, OPL-SECRET-001)
- JWT_SECRET not in dist/ (closes MW-FE-001)
- Lambda IAM scoped to specific resources (closes OPL-IAM-001)

---

## PR 2 — High Severity (2-3 days)

### PR 2.1 — Velocity Counter + Fraud Engine

**RED (2h)**:
- [ ] Test: counter increments on first call
- [ ] Test: counter returns new count
- [ ] Test: counter above threshold emits VELOCITY_EXCEEDED
- [ ] Test: UserHistory lookup with prior BLOCK returns auto-BLOCK
- [ ] Test: FraudEngine with single TOR_EXIT (1.0) → BLOCK
- [ ] Test: FraudEngine with 5 weak signals (0.15 each) → REVIEW (not BLOCK)
- [ ] Test: FraudEngine with 2 strong signals (0.6 + 0.5) → BLOCK
- [ ] Test: VELOCITY_EXCEEDED signal weight 0.6 included in fraud score
- [ ] Test: device fingerprint mismatch detected for new device
- [ ] Test: per-BIN limit 10/min enforced
- [ ] Test: per-IP limit 50/5min enforced
- [ ] Test: per-email limit 100/h enforced
- [ ] Test: legitimate power user (30/day) not blocked

**GREEN (4h)**:
- [ ] Implement `velocity/counter.ts`: TTL-based counter
- [ ] Implement `velocity/user-history.ts`: prior BLOCK lookup
- [ ] Implement `velocity/signals.ts`: emit to fraud engine
- [ ] Modify `fraud.ts`: integrate velocity signals + normalize formula
- [ ] Add `VelocityCounters` table to sst.config.ts
- [ ] Add `UserHistory` table to sst.config.ts

**REFACTOR (1h)**:
- [ ] Verify 90% coverage
- [ ] Update `runFraudChecks` to call velocity counter

**Acceptance**: Closes OPL-CARD-001, 005, 006, 007, 012, 015.

---

### PR 2.2 — Bonus Engine Hardening

**RED (2h)**:
- [ ] Test: cashback above daily cap → DAILY_AMOUNT_LIMIT_EXCEEDED
- [ ] Test: cashback above daily claims cap → DAILY_CLAIM_LIMIT_EXCEEDED
- [ ] Test: FIRST_PURCHASE_CASHBACK atomic claim (closes OPL-LIB-008, OPL-CARD-019)
- [ ] Test: `contextTs` parameter removed (input rejects it)
- [ ] Test: bonus reversal on chargeback wired
- [ ] Test: per-rule cap fields read correctly
- [ ] Test: BonusStore.recordBonus uses ConditionExpression
- [ ] Test: cumulative cap tracked in BonusDailyCounter
- [ ] Test: weekly cap for streak bonus
- [ ] Test: max 20 claims/day/user

**GREEN (3h)**:
- [ ] Modify `bonus-rules.ts`: add `maxClaimsPerDay`, `maxAmountPerDayCop`, `maxAmountPerWeekCop`
- [ ] Modify `bonuses.ts`: remove `contextTs`, use `BonusEngineDeps.now()`
- [ ] Modify `bonuses.ts`: cap enforcement in triggerRule
- [ ] Add `BonusDailyCounter` table to sst.config.ts
- [ ] Implement `transactBonusClaim` integration
- [ ] Wire bonus reversal in `webhook-gateway/state-machines/transaction.ts` (handleReversed)

**Acceptance**: Closes OPL-LIB-003, OPL-CARD-005, OPL-CARD-019.

---

### PR 2.3 — Referral Anti-Fraud

**RED (1h)**:
- [ ] Test: 11 referrals in same month → 11th throws MONTHLY_REFERRAL_LIMIT_EXCEEDED
- [ ] Test: `acceptCode` without AntiFraudContext → 400 MISSING_ANTI_FRAUD_CONTEXT
- [ ] Test: extract IP from requireUser in acceptCode
- [ ] Test: extract device_id from header
- [ ] Test: self-referral still blocked
- [ ] Test: cross-device referral blocked

**GREEN (2h)**:
- [ ] Modify `referrals.ts`: add `maxReferralsPerMonth` field
- [ ] Modify `referrals.ts`: required AntiFraudContext fields
- [ ] Add `ReferralMonthlyCounter` table to sst.config.ts
- [ ] Modify `api/referrals.ts`: extract IP + device from auth context

**Acceptance**: Closes OPL-LIB-009, OPL-CARD-010.

---

### PR 2.4 — Escrow SSRF + State Machine

**RED (1h)**:
- [ ] Test: photo_url with `169.254.169.254` → EVIDENCE_URL_INVALID
- [ ] Test: photo_url with `http://` (non-HTTPS) → EVIDENCE_URL_INVALID
- [ ] Test: photo_url with HTTPS valid → accepted
- [ ] Test: photo_url with javascript: scheme → EVIDENCE_URL_INVALID
- [ ] Test: state machine uses transactEscrowTransition (atomic)
- [ ] Test: concurrent DELIVERY_CONFIRM + DISPUTE → only 1 succeeds
- [ ] Test: evidence required for tx > 1M COP

**GREEN (2h)**:
- [ ] Implement `isSafeUrl()` validator in `escrow.ts`
- [ ] Modify `escrow.ts`: use transactEscrowTransition
- [ ] Modify `api/delivery.ts`: use processTransportadoraWebhook

**Acceptance**: Closes OPL-LIB-004, OPL-CARD-009, OPL-LIB-012.

---

## PR 3 — Medium Severity (1-2 days)

### PR 3.1 — Frontend Bundle Security

**RED (2h)**:
- [ ] Test: build → dist/ has no JWT_SECRET
- [ ] Test: build → dist/ has no DPO_EMAIL
- [ ] Test: Wompi widget script has SRI integrity attribute
- [ ] Test: Wompi widget script has crossOrigin=anonymous
- [ ] Test: CSP header present in response
- [ ] Test: X-Frame-Options: DENY present
- [ ] Test: CSRF cookie set on GET
- [ ] Test: CSRF token validated on POST
- [ ] Test: no generator meta tag in HTML
- [ ] Test: HSTS header present

**GREEN (4h)**:
- [ ] Modify `cognito-sso-consumer.ts`: use authGateway (read JWT_SECRET at runtime)
- [ ] Modify `wompi-widget.ts`: add SRI + crossOrigin
- [ ] Modify `api-client.ts`: send X-CSRF-Token header
- [ ] Modify `middleware.ts`: add CSP + security headers
- [ ] Modify `BaseLayout.astro`: remove generator meta
- [ ] Add `__csrf` cookie issuance in backend

**Acceptance**: Closes MW-FE-001, 002, 005, 010.

---

### PR 3.2 — WAF + Observability

**RED (2h)**:
- [ ] Test: 7 CloudWatch alarms defined in sst.config.ts
- [ ] Test: Lambda reserved concurrency = 10
- [ ] Test: WAF WebACL attached to Lambda URL
- [ ] Test: WAF rate rule 100 req/5min
- [ ] Test: WAF geo restriction
- [ ] Test: DLQ for failed webhooks
- [ ] Test: webhook failure → DLQ depth increment
- [ ] Test: Lambda log group retention 30 days

**GREEN (3h)**:
- [ ] Update `sst.config.ts`: add 7 CloudWatch alarms
- [ ] Update `sst.config.ts`: reserved concurrency
- [ ] Update `sst.config.ts`: WAF WebACL
- [ ] Update `sst.config.ts`: DLQ for webhooks

**Acceptance**: Closes OPL-IAM-005, OPL-API-006 (operational), OPL-API-009 (DLQ).

---

### PR 3.3 — Structured Logging + X-Ray

**RED (1h)**:
- [ ] Test: all log lines are valid JSON
- [ ] Test: log level field present
- [ ] Test: PII hashed in logs (email → SHA-256[:16])
- [ ] Test: X-Ray tracing enabled

**GREEN (2h)**:
- [ ] Implement `lib/logger.ts`: structured JSON logger
- [ ] Update all `console.log` to use logger
- [ ] Update sst.config.ts: X-Ray tracing

**Acceptance**: Closes operational visibility gap.

---

## PR 4 — Compliance (parallel, ongoing)

### PR 4.1 — UIAF Cron Wiring

**RED (2h)**:
- [ ] Test: cron Lambda wired to EventBridge schedule
- [ ] Test: detects tx > 5M COP (cash)
- [ ] Test: detects tx > 10M COP (non-cash)
- [ ] Test: SAR generated and stored
- [ ] Test: 5+ tx of 900k-1M in 24h → STRUCTURING_SUSPECTED
- [ ] Test: SES alerter sends to DPO
- [ ] Test: cron retry on failure
- [ ] Test: idempotent cron (no duplicate SAR)

**GREEN (4h)**:
- [ ] Update `sst.config.ts`: EventBridge schedule `rate(1 hour)`
- [ ] Implement `crons/uiaf-monitor.ts`: run() wired
- [ ] Implement SAR XML generation
- [ ] Implement structuring detection logic
- [ ] Add `UiafReports` table to sst.config.ts
- [ ] Add `TimeAmountIndex` GSI to transactions table

**Acceptance**: Closes OPL-COMP-014, 015, 016, 017.

---

### PR 4.2 — PEP + Sanctions (External Service)

**RED (1h)**:
- [ ] Test: onboarding triggers PEP screening
- [ ] Test: PEP match → enhanced due diligence flag
- [ ] Test: tx > 1M COP → sanctions screening
- [ ] Test: sanctions match → tx BLOCKED
- [ ] Test: monthly re-screening for Tier 2+
- [ ] Test: provider API failure → graceful degradation

**GREEN (4h)**:
- [ ] Provider selection: ComplyAdvantage or alternative
- [ ] Implement `compliance/pep.ts`: onboarding screening
- [ ] Implement `compliance/sanctions.ts`: tx screening
- [ ] Add `ComplianceScreenings` table to sst.config.ts
- [ ] Add monthly EventBridge schedule for re-screening

**Acceptance**: Closes OPL-COMP-018, 019.

---

## Operational Tasks (Parallel, Operator-Driven)

- [ ] **SIC registration**: Operator obtains closed-loop wallet registration under Decreto 222/2020
- [ ] **SIC certificate storage**: Operator stores certificate in S3 WORM bucket
- [ ] **External auditor**: Operator commissions post-Phase 1 external pentest
- [ ] **Insurance**: Operator obtains cyber-security insurance
- [ ] **Incident response plan**: Operator finalizes + tests

---

## PR Delivery Strategy

### Ask-on-Risk
For each PR:
1. Run `sdd-verify` (full test suite + coverage check)
2. Surface all CRITICAL findings
3. Wait for operator approval before merging

### Chained PRs
PRs 1.1 → 1.2 → 1.3 → 1.4 → 2.1 → 2.2 → 2.3 → 2.4 → 3.1 → 3.2 → 3.3 → 4.1 → 4.2
Each merges to main. No long-lived branches. Reverts safe (feature flags).

### Work-Unit Commits
Each PR has 3-5 commits:
1. RED (failing tests)
2. GREEN (implementation)
3. REFACTOR (cleanup)
4. Documentation (if needed)

### Coverage Gate
- 90% lines, 85% branches, 90% functions, 90% statements
- `src/api/**` and `src/lib/auth.ts` can be excluded IF integration tests cover them (PR 8)

### Test Suite Health
- Must complete in < 60s
- No flaky tests
- 100% deterministic (no time-based assertions without DI clock)

---

## Definition of Done (Per PR)

- [ ] All RED tests written and failing
- [ ] All GREEN implementation done
- [ ] All REFACTOR cleanup done
- [ ] All 311+ existing tests still pass
- [ ] Coverage ≥ 90%
- [ ] No new `as any` or `// @ts-ignore`
- [ ] No new console.log (use structured logger)
- [ ] Commit message references finding IDs closed (e.g., `fix: OPL-LIB-005, MW-FE-003`)
- [ ] `sdd-verify` green
- [ ] Operator approval before merge

---

## Tracking

Each PR's progress tracked in dark-mem:
- `sdd/pre-deploy-remediation/pr-1.1-{red|green|refactor|done}`
- Findings closed: `pentest/opita-pagos-foundation/fixes/OPL-LIB-005` (etc.)

---

## Next: Start PR 1.1

**TDD sequence (PR 1.1 — Auth Gateway)**:

1. RED: Write 12 failing tests in `tests/unit/auth/`
2. Run vitest → confirm 12 failures
3. GREEN: Implement `src/lib/auth/{jwt,rbac,dev-bypass,gateway,rate-limit}.ts`
4. Run vitest → confirm all pass
5. REFACTOR: Extract shared code, add JSDoc
6. Verify ≥90% coverage
7. Commit: `feat(auth): PR 1.1 - Auth Gateway (closes OPL-LIB-005, MW-FE-003, MW-FE-006)`
