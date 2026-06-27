# Spec: wallet-lifecycle

## Purpose
A closed-loop wallet pegged 1:1 to COP, with tier-aware limits and time-based withdrawal holds. The wallet is NOT money — it is a credit that can be redeemed to Bre-B. The ledger is append-only; balance is a projection derived from the ledger.

## Requirements

### Requirement: Wallet Creation

A wallet MUST be created automatically when a user first interacts with the payments API.

#### Scenario: First wallet creation
- GIVEN a Cognito-authenticated user `U` with email `e@x.com` who has never transacted
- WHEN `GET /v1/wallet/e@x.com/balance` is called
- THEN the system MUST create a `MarketWallets` row with `balance_cop=0`, `tier=0`, `kyc_state=INCOMPLETE`
- AND return `{balance_cop: 0, tier: 0, kyc_state: "INCOMPLETE", receive_limit_day_cop: 500000}`

### Requirement: Append-Only Ledger

Every balance change MUST be recorded as a `MarketLedger` entry; the running balance is the projection.

#### Scenario: Successful deposit appends ledger
- GIVEN wallet `V` with `balance_cop=1000`
- WHEN a deposit of `500` is confirmed
- THEN a `MarketLedger` row MUST be appended with `{user_id: V, movement: "DEPOSITO", amount_cop: 500, balance_after_cop: 1500}`
- AND `MarketWallets.balance_cop` MUST become `1500`

#### Scenario: Ledger entries are immutable
- GIVEN an existing `MarketLedger` row for user `V` at `ts=T1`
- WHEN any code attempts to UPDATE or DELETE that row
- THEN the operation MUST be rejected by the DB layer (immutable)

### Requirement: Tier Limit Enforcement

The system MUST reject operations that exceed the user's tier limit.

#### Scenario: Receive exceeds tier daily limit
- GIVEN wallet `V` with tier=1 (`receiveLimitDayCop=2_000_000`) AND `lifetime_received_today=1_900_000`
- WHEN a payment intent of `200_000` is attempted to `V`
- THEN the system MUST reject with HTTP 422 AND `error_code="TIER_LIMIT_EXCEEDED"`
- AND MUST NOT create the intent

### Requirement: Withdrawal Hold

The system MUST enforce the tier's withdrawal hold window before releasing funds.

#### Scenario: Withdrawal before hold expires
- GIVEN wallet `V` with tier=1 (`withdrawHoldHours=24`) AND a deposit from `2026-06-26T10:00:00Z`
- WHEN `POST /v1/wallet/V/withdraw` is called at `2026-06-26T15:00:00Z` (5 hours later)
- THEN the system MUST reject with HTTP 422 AND `error_code="WITHDRAW_HOLD_NOT_ELAPSED"`
- AND MUST specify `available_at` in the response

#### Scenario: Withdrawal after hold expires
- GIVEN wallet `V` with tier=1 AND a deposit from `2026-06-25T10:00:00Z`
- WHEN withdrawal is called at `2026-06-26T11:00:00Z` (>24h later)
- THEN the system MUST process the withdrawal to Wompi/Bre-B
- AND write a `RETIRO` entry to the ledger

### Requirement: Concurrent Balance Updates

The system MUST prevent lost updates under concurrent operations.

#### Scenario: 100 concurrent top-ups + 100 concurrent withdrawals
- GIVEN wallet `V` with `balance_cop=0`
- WHEN 100 top-ups of `+100` AND 100 withdrawals of `-100` are issued concurrently
- THEN the final `balance_cop` MUST equal `0`
- AND the ledger MUST contain exactly 200 entries
- AND no entry MAY be lost (verified by `sum(entries) == final_balance`)

## Files
- `packages/pagos-service/src/api/wallet.ts`
- `packages/pagos-service/src/lib/ledger.ts`
- `packages/pagos-service/src/db/schema.sql` (immutability triggers on `market_ledger`)
- `packages/pagos-service/tests/integration/wallet-lifecycle.test.ts`