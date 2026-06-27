# Spec: transact-wrapper

## Purpose

Several financial operations (P2P transfer, escrow state transition, bonus claim, wallet debit) currently use multiple separate DynamoDB UpdateCommands. If any step fails mid-way, the operation is left in an inconsistent state — funds can be lost, bonuses can be double-applied, escrow can be in impossible states. This spec introduces a transact wrapper that guarantees atomicity.

## Requirements

### R1 — Single-call atomicity
- `transact(items[])` wraps DynamoDB `TransactWriteItems`
- All items succeed or all fail
- Returns success with all updated values, or throws `TransactError` on any failure
- Maximum 100 items per call (DynamoDB limit)

### R2 — Retry with backoff
- On `TransactionConflictException` (concurrent transaction): retry up to 3 times with exponential backoff (10ms, 50ms, 200ms)
- On `ConditionalCheckFailedException`: do NOT retry, throw `ConditionFailedError` with the failed condition name

### R3 — Typed operations
- `transactDebitWallet({ userId, amountCop, idempotencyKey })` — atomic balance check + decrement
- `transactCreditWallet({ userId, amountCop })` — atomic increment
- `transactP2PTransfer({ fromUserId, toUserId, amountCop, idempotencyKey })` — atomic debit + credit
- `transactEscrowTransition({ txId, fromState, toState, evidence? })` — atomic state change + ledger entry
- `transactBonusClaim({ userId, ruleId, amountCop, transactionId })` — atomic balance credit + bonus record
- All return typed result, not raw DynamoDB response

### R4 — Idempotency enforcement
- Every transact call accepts `idempotencyKey` (UUID v4)
- DynamoDB ConditionExpression: `last_idempotency_key <> :idem`
- Different key with same item: update succeeds
- Same key with same item: throws `DuplicateIdempotencyError`
- Same key with different payload: throws `ConflictingIdempotencyError`

### R5 — No balance leak on failure
- All error messages MUST be generic (e.g., "Insufficient balance")
- The error response MUST NOT include the actual balance value
- Internal logging CAN include balance for audit, but NEVER in client response

### R6 — Ledger entry for every money movement
- Every successful `transact*` that moves money MUST write a corresponding Ledger entry
- Ledger entry: `{ userId, ts, amountCop, type, ref, idempotencyKey }`
- Ledger entry write is atomic with the money movement (same TransactWriteItems)

## Scenarios

### S1 — P2P transfer with concurrent failure
- User A has 100,000 COP
- Sends 100,000 COP to B
- DynamoDB throttles the credit leg
- **Expected**: Both legs fail, A's balance unchanged, B's balance unchanged, ledger has no entry
- **Closes**: OPL-API-001, OPL-CARD-003

### S2 — Debit with insufficient balance
- User A has 0 COP
- Attempts to debit 100 COP
- **Expected**: `ConditionFailedError('INSUFFICIENT_BALANCE')`, no balance value in error
- **Closes**: OPL-LIB-002, OPL-LIB-006

### S3 — Idempotency replay
- Client sends same idempotencyKey twice within 5 minutes
- **Expected**: Second call returns cached result from first call (no double-charge)
- **Closes**: OPL-API-004 (partial)

### S4 — Escrow state transition with concurrent CHARGEBACK
- Transaction in HELD state
- Seller sends DELIVERY_CONFIRM
- Buyer sends DISPUTE (within 72h)
- Both arrive at different Lambda instances within 10ms
- **Expected**: Only one succeeds. The other throws `TransactError('STATE_CONFLICT')`
- **Closes**: OPL-LIB-012 (state machine race)

### S5 — Bonus claim with concurrent same-user
- User has 0 prior bonuses
- Two concurrent requests for FIRST_PURCHASE_CASHBACK
- **Expected**: First succeeds, second throws `ConditionFailedError('BONUS_ALREADY_CLAIMED')`
- **Closes**: OPL-LIB-008, OPL-CARD-019

## Out of Scope

- Cross-region transactions (single region only)
- Cross-table transactions beyond what fits in 100 items
- Currency conversion (always COP)
- Reversal transactions (handled by separate `transactRefund`)
