# Design: pre-deploy-remediation

## Architecture Overview

Three new gateway layers replace per-endpoint checks and 3 separate operations. The rest of the system is hardened to use the new layers.

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Request                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   authGateway(ctx)   │  R1: JWT verify + aud + iss
              │                      │  R2: RBAC (requireRole)
              │                      │  R3: DEV_AUTH_ENABLED flag
              │                      │  R5: rate limit per role
              └──────────┬───────────┘
                         │ AuthContext
                         ▼
              ┌──────────────────────┐
              │   Endpoint handler   │  Business logic
              │   (uses transact*)   │  R4: P2P via transactP2PTransfer
              │                      │  Bonus via transactBonusClaim
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   transact(items[])  │  Atomic multi-item writes
              │   (DynamoDB TWI)     │  Retry on conflict, no retry on condition fail
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Velocity counter    │  Per-BIN/IP/device/email
              │  + User history      │  Emits VELOCITY_EXCEEDED
              └──────────────────────┘

For webhooks (Wompi, transportadora):
                         │
                         ▼
              ┌──────────────────────┐
              │  webhookGateway(ev)  │  R1: HMAC + timingSafeEqual
              │                      │  R2: timestamp < 5min
              │                      │  R3: idempotency via ProcessedWebhooks
              │                      │  R4: event type dispatch
              │                      │  R5: 3DS verify (cache 1h)
              │                      │  R6: transportadora signature + auth
              └──────────┬───────────┘
                         │
                         ▼
              EscrowStateMachine.transition()  →  transactEscrowTransition()
                                                  →  transactCreditWallet() (if NONE)
```

## The 3 Core Gateways

### 1. Auth Gateway

**Location**: `packages/pagos-service/src/lib/auth/` (new) + `apps/market-web/src/lib/auth/` (new)

**Public API**:
```typescript
// authGateway.ts
export async function authGateway(ctx: Context): Promise<AuthContext>
export function requireRole(ctx: AuthContext, role: Role | Role[]): void
export function requireDpo(ctx: AuthContext): void
export function requireUser(ctx: AuthContext): UserContext

// Type
export interface AuthContext {
  userId: string
  email: string
  groups: Role[]
  deviceId?: string
  ip: string
  authMethod: 'jwt' | 'dev-bypass' | 'webhook-signature'
}

// dev-bypass.ts
export const DEV_AUTH_FLAG = 'DEV_AUTH_ENABLED'
export function isDevBypassEnabled(): boolean  // returns process.env[DEV_AUTH_FLAG] === 'true'

// rbac.ts
export const ROLES = { USER: 'user', MERCHANT: 'merchant', DPO: 'dpo', ADMIN: 'admin' } as const
export function hasRole(ctx: AuthContext, role: Role | Role[]): boolean
```

**Integration**: All 8 API route files replace per-endpoint auth with `authGateway(ctx)` + `requireRole(...)`. Cognito-sso-consumer (frontend) uses same `authGateway` for consistency.

**Backwards compat**: Existing tests pass with `DEV_AUTH_ENABLED='true'` in test env.

### 2. Webhook Gateway

**Location**: `packages/pagos-service/src/lib/webhook-gateway/` (new)

**Public API**:
```typescript
// gateway.ts
export async function processWompiWebhook(rawBody: unknown): Promise<WebhookResult>
export async function processTransportadoraWebhook(rawBody: unknown, signature: string, transportadoraId: string): Promise<WebhookResult>

// verify.ts
export function verifySignature(body: WompiEvent, secret: string): void
export function verifyTimestamp(body: WompiEvent, maxAgeMs?: number): void  // default 5min

// replay.ts
export async function isReplay(eventId: string): Promise<boolean>
export async function markProcessed(eventId: string, txId: string): Promise<void>

// pipeline.ts
export async function dispatchEvent(event: WompiEvent): Promise<WebhookResult>
// returns { ok: true, txId, newState }

// state-machines/transaction.ts
export type WompiEventType = 'transaction.approved' | 'transaction.declined' | 'transaction.reversed' | 'transaction.disputed'
export async function handleApproved(txId: string, event: WompiEvent): Promise<TransitionResult>
export async function handleDeclined(txId: string): Promise<void>
export async function handleReversed(txId: string): Promise<void>
export async function handleDisputed(txId: string): Promise<void>
```

**State Machine Integration**:
- `handleApproved`: call `transactEscrowTransition()` to move state, then `transactCreditWallet()` if state was NONE
- `handleDeclined`: `transactEscrowTransition()` to FAILED
- `handleReversed`: `transactEscrowTransition()` to REFUNDED + `reverseBonusesForTransaction()`
- `handleDisputed`: `transactEscrowTransition()` to DISPUTED

**Idempotency Storage**:
- `ProcessedWebhooks` table: `pk=event_id`, `tx_id`, `processed_at`, `ttl=7 days`
- Lookup before processing; PutItem with `ConditionExpression: attribute_not_exists(event_id)` after

### 3. Transact Wrapper

**Location**: `packages/pagos-service/src/lib/transact/` (new)

**Public API**:
```typescript
// wrapper.ts
export async function transact<T>(items: TransactItem[]): Promise<TransactResult<T>>
export type TransactItem = { Update: UpdateItemSpec } | { Put: PutItemSpec } | { Delete: DeleteItemSpec } | { ConditionCheck: ConditionCheckItemSpec }

// wallet.ts
export async function transactDebitWallet(input: { userId: string; amountCop: number; idempotencyKey: string }): Promise<{ newBalanceCop: number; version: number }>
export async function transactCreditWallet(input: { userId: string; amountCop: number; idempotencyKey: string }): Promise<{ newBalanceCop: number; version: number }>
export async function transactP2PTransfer(input: { fromUserId: string; toUserId: string; amountCop: number; idempotencyKey: string }): Promise<{ fromBalanceCop: number; toBalanceCop: number }>

// escrow.ts
export async function transactEscrowTransition(input: { txId: string; fromState: EscrowState; toState: EscrowState; evidence?: DeliveryEvidence; idempotencyKey: string }): Promise<{ tx: EscrowTransaction }>

// bonus.ts
export async function transactBonusClaim(input: { userId: string; ruleId: string; amountCop: number; transactionId: string }): Promise<{ newBalanceCop: number; bonusId: string }>

// Errors
export class TransactError extends OpitaPagosError { code: 'TRANSACT_FAILED' }
export class ConditionFailedError extends OpitaPagosError { code: 'CONDITION_FAILED'; failedCondition: string }
export class DuplicateIdempotencyError extends OpitaPagosError { code: 'DUPLICATE_IDEMPOTENCY_KEY' }
export class InsufficientBalanceError extends OpitaPagosError { code: 'INSUFFICIENT_BALANCE' }  // generic, no balance leak
```

**Retry logic**:
- `TransactionConflictException` → retry up to 3x with backoff (10ms, 50ms, 200ms)
- `ConditionalCheckFailedException` → no retry, throw with `failedCondition` name
- Other errors → no retry, throw

**Idempotency enforcement**:
- Every operation includes `idempotencyKey` in ConditionExpression on the primary item
- `ConditionExpression: attribute_not_exists(idempotency_key) OR idempotency_key = :idem`
- Conflicting key with same payload: success (idempotent retry)
- Conflicting key with different payload: throw `ConflictingIdempotencyError`

## File Structure

```
packages/pagos-service/src/
├── lib/
│   ├── auth/                          # NEW
│   │   ├── gateway.ts                 # authGateway, requireRole, requireDpo
│   │   ├── jwt.ts                     # verify + aud + iss checks
│   │   ├── rbac.ts                    # ROLES, hasRole
│   │   ├── dev-bypass.ts              # DEV_AUTH_ENABLED flag
│   │   ├── allowlist.ts               # Wompi IP allowlist (data)
│   │   └── rate-limit.ts              # Redis counter
│   ├── webhook-gateway/               # NEW
│   │   ├── gateway.ts                 # processWompiWebhook, processTransportadoraWebhook
│   │   ├── verify.ts                  # signature + timestamp
│   │   ├── replay.ts                  # idempotency via ProcessedWebhooks
│   │   ├── pipeline.ts                # event dispatch
│   │   ├── state-machines/
│   │   │   └── transaction.ts         # approved/declined/reversed/disputed handlers
│   │   └── sri-hash.ts                # Wompi SRI hash (from env)
│   ├── transact/                      # NEW
│   │   ├── wrapper.ts                 # transact<T> + retry logic
│   │   ├── wallet.ts                  # transactDebitWallet, transactCreditWallet, transactP2PTransfer
│   │   ├── escrow.ts                  # transactEscrowTransition
│   │   ├── bonus.ts                   # transactBonusClaim
│   │   └── errors.ts                  # TransactError, ConditionFailedError, etc.
│   ├── velocity/                      # NEW
│   │   ├── counter.ts                 # increment + threshold check
│   │   ├── user-history.ts            # prior BLOCK lookup
│   │   ├── signals.ts                 # emit to fraud engine
│   │   └── fingerprint.ts             # device_id persistence
│   ├── fraud.ts                       # MODIFIED: integrate velocity + normalize
│   ├── bonus-rules.ts                 # MODIFIED: add cap fields
│   ├── bonuses.ts                     # MODIFIED: use transactBonusClaim, remove contextTs
│   ├── referrals.ts                   # MODIFIED: required anti-fraud, monthly cap
│   ├── escrow.ts                      # MODIFIED: SSRF validation, use transact
│   ├── auth.ts                        # DELETED (replaced by auth/gateway)
│   ├── http-errors.ts                 # MODIFIED: 401/403/429 generic messages
│   └── wompi.ts                       # MODIFIED: split into verify + webhook-gateway
├── crons/
│   ├── uiaf-monitor.ts                # MODIFIED: wire to EventBridge, SAR filing, structuring
│   ├── reconciliation.ts              # MODIFIED: dual-control (DPO approval for status change)
│   └── ip2proxy-update.ts             # MODIFIED: health check + retry
├── tests/
│   ├── unit/
│   │   ├── auth/                      # NEW
│   │   ├── webhook-gateway/           # NEW
│   │   ├── transact/                  # NEW
│   │   └── velocity/                  # NEW
│   └── integration/                   # NEW
│       ├── e2e-p2p-transfer.test.ts
│       ├── e2e-webhook-replay.test.ts
│       └── e2e-uiaf-cron.test.ts
└── api/
    ├── index.ts                       # MODIFIED: use authGateway, add body limit
    ├── payments.ts                    # MODIFIED: use webhookGateway
    ├── wallet.ts                      # MODIFIED: use transactP2PTransfer
    ├── tier.ts                        # MODIFIED: use authGateway + requireDpo
    ├── bonuses.ts                     # MODIFIED: use transactBonusClaim
    ├── referrals.ts                   # MODIFIED: required anti-fraud
    ├── delivery.ts                    # MODIFIED: use processTransportadoraWebhook
    └── emergency.ts                   # MODIFIED: use authGateway + requireDpo
```

```
apps/market-web/src/
├── lib/
│   ├── auth/                          # NEW (mirrors backend)
│   │   ├── gateway.ts
│   │   ├── jwt.ts                     # aud: market.opitacode.com
│   │   ├── dev-bypass.ts              # DEV_AUTH_ENABLED flag
│   │   └── csrf.ts                    # read __csrf cookie
│   ├── cognito-sso-consumer.ts        # MODIFIED: use authGateway
│   ├── api-client.ts                  # MODIFIED: add X-CSRF-Token header
│   └── wompi-widget.ts                # MODIFIED: SRI + crossOrigin
├── middleware.ts                      # MODIFIED: CSP + security headers
└── components/
    └── market/                        # (no changes in this PR)

sst.config.ts                          # MODIFIED: 4 new SST Secrets + 7 alarms + WAF + reserved concurrency
RUNBOOK.md                             # MODIFIED: rotation procedure + incident response
```

## ADRs (Architecture Decision Records)

### ADR-001: Auth Gateway as central middleware
**Decision**: One `authGateway(ctx)` function used by all endpoints.
**Alternatives**: Per-endpoint auth (current), auth-as-service (overkill for Lambda).
**Rationale**: Reusable, testable once, consistent error handling.

### ADR-002: Dev-bypass via `DEV_AUTH_ENABLED` flag, not `NODE_ENV`
**Decision**: Require explicit `DEV_AUTH_ENABLED=true` in env.
**Alternatives**: `NODE_ENV !== 'production'`, `STAGE === 'dev'`.
**Rationale**: Lambda default `NODE_ENV=undefined`. Explicit flag is fail-closed. `STAGE` requires SST restructure.

### ADR-003: Webhook idempotency via dedicated `ProcessedWebhooks` table
**Decision**: New DynamoDB table with 7-day TTL.
**Alternatives**: In-memory cache (lost on restart), GSI on transactions table (pollutes).
**Rationale**: Simple, durable, no false positives. TTL handles cleanup.

### ADR-004: TransactWriteItems for all multi-item writes
**Decision**: Wrap every multi-item write in `transact(items[])`.
**Alternatives**: Manual rollback, eventual consistency.
**Rationale**: DynamoDB guarantees atomicity. Rollback is impossible for non-DDB operations.

### ADR-005: Idempotency key as ConditionExpression, not separate
**Decision**: Embed `idempotencyKey` in item's `ConditionExpression`.
**Alternatives**: Separate `IdempotencyKeys` table (extra read).
**Rationale**: Single atomic write, no race condition, no extra cost.

### ADR-006: Velocity counters with TTL, not window slides
**Decision**: DynamoDB TTL for cleanup.
**Alternatives**: Redis (extra infra), scheduled cleanup (operational burden).
**Rationale**: TTL is automatic, zero ops. Slight over-counting accepted.

### ADR-007: User history for fraud repeat-offender
**Decision**: `UserHistory` table with 30-day TTL.
**Alternatives**: In-memory only (lost on restart), Redis.
**Rationale**: Durable, simple, no extra infra.

### ADR-008: Fraud score = max(weights), not sum
**Decision**: Single strong signal triggers BLOCK.
**Alternatives**: Sum (current, high FPR), weighted average.
**Rationale**: Tor exit (1.0) MUST trigger BLOCK immediately. Sum creates false positives.

### ADR-009: PEP/sanctions via external service, not homegrown
**Decision**: Integrate ComplyAdvantage or equivalent.
**Alternatives**: Manual screening (doesn't scale), OFAC API only (incomplete).
**Rationale**: Curated lists, real-time updates, audit trail. Cost: ~$500-2000/month.

### ADR-010: CSRF double-submit cookie, not Synchronizer Token
**Decision**: Backend sets `__csrf` cookie, frontend sends as `X-CSRF-Token`.
**Alternatives**: Synchronizer token (server-side session), SameSite=Strict only.
**Rationale**: Stateless, works with CDN, no server-side session needed. SameSite=Strict insufficient for cross-domain flows.

### ADR-011: SRI for Wompi widget only, not all third-party scripts
**Decision**: Wompi widget gets SRI. No other third-party scripts in v1.
**Alternatives**: SRI for all (some scripts don't publish hashes), no SRI (current).
**Rationale**: Wompi is the highest-risk third-party (payment data). Other scripts are analytics/monitoring with lower risk.

### ADR-012: AWS WAF, not Cloudflare WAF
**Decision**: AWS WAF attached to Lambda Function URL.
**Alternatives**: Cloudflare WAF (already using Cloudflare Pages for frontend), no WAF.
**Rationale**: Single layer of WAF (AWS-native). Cloudflare WAF on Pages doesn't protect Lambda.

## Test Strategy

### Unit tests (per module)
- 100% coverage for the 3 gateways (high risk)
- 90% coverage for hardening changes
- 80% coverage for refactor changes (lower risk)

### Integration tests (e2e)
- `e2e-p2p-transfer.test.ts`: send 2 concurrent transfers, verify atomicity
- `e2e-webhook-replay.test.ts`: send same webhook twice, verify idempotency
- `e2e-uiaf-cron.test.ts`: trigger cron, verify SAR generated
- `e2e-auth-bypass.test.ts`: verify all 5 auth scenarios from spec
- `e2e-velocity.test.ts`: send 100 probes, verify BLOCK

### Property-based tests
- `transactDebitWallet` with concurrent updates: balance never goes negative
- `transactP2PTransfer` with N concurrent transfers: sum of balances invariant

### Performance tests
- Auth gateway: < 5ms p99 latency
- Webhook gateway: < 50ms p99 (includes Wompi API call)
- Transact wrapper: < 100ms p99

## Migration Plan

### Phase 1 (PR 1, this week)
1. **PR 1.1**: Auth Gateway module + tests (no integration yet)
2. **PR 1.2**: Webhook Gateway module + tests
3. **PR 1.3**: Transact wrapper module + tests
4. **PR 1.4**: Integrate gateways into 8 API files + sst.config.ts (secrets)

### Phase 2 (next week)
1. **PR 2.1**: Velocity counter + fraud engine integration
2. **PR 2.2**: Bonus engine hardening + transactBonusClaim
3. **PR 2.3**: Referral anti-fraud + monthly cap
4. **PR 2.4**: Escrow SSRF validation

### Phase 3 (week 3)
1. **PR 3.1**: Frontend bundle security (SRI, CSP, CSRF)
2. **PR 3.2**: WAF + reserved concurrency + CloudWatch alarms
3. **PR 3.3**: Structured logging + X-Ray

### Phase 4 (parallel, ongoing)
1. SIC registration (legal process, days-weeks)
2. UIAF SAR filing API (when available)
3. PEP/sanctions provider selection + integration

### Backwards Compatibility
- Each PR introduces new modules with feature flags (`AUTH_GATEWAY_ENABLED`, `WEBHOOK_GATEWAY_ENABLED`, `TRANSACT_ENABLED`)
- If a PR causes regressions, disable the flag → PR revertible
- No data migrations required
- Existing 311 tests must pass throughout
