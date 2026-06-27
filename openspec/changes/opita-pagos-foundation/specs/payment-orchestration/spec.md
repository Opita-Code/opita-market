# Spec: payment-orchestration

## Purpose
Orchestrate payment intents through Wompi (Bre-B + cards) with idempotent state transitions and a deterministic state machine. The single source of truth for any payment's status is `MarketTransactions.status`. Every state change is idempotent — replaying a webhook N times produces exactly 1 ledger effect.

## Requirements

### Requirement: Payment Intent Creation

The system MUST create a payment intent that is uniquely identified and idempotent.

#### Scenario: New payment intent succeeds
- GIVEN a user `U` with tier ≥ 1 AND an `Idempotency-Key` header not seen before
- WHEN `POST /v1/payments/intent` is called with `{amount_cop, channel, from_user_id, to_user_id, product_context}`
- THEN the system MUST create a `MarketTransactions` row with status `PENDING`
- AND MUST return `{transaction_id, reference, integrity_signature, expires_at}`
- AND MUST reject the request with HTTP 409 if the `Idempotency-Key` was used in the last 24h

#### Scenario: Idempotent replay
- GIVEN a payment intent was created with `Idempotency-Key: K1` 5 minutes ago
- WHEN the same request is replayed with the same `Idempotency-Key: K1`
- THEN the system MUST return the existing transaction record (not create a new one)
- AND MUST NOT trigger a Wompi API call

### Requirement: Webhook State Transitions

The system MUST process Wompi webhooks idempotently and atomically.

#### Scenario: APPROVED webhook credits wallet once
- GIVEN a `MarketTransactions` row in status `PENDING` for user `V`
- WHEN Wompi sends `transaction.updated` with status `APPROVED` for tx_id `T1`
- THEN the system MUST transition the row to status `APPROVED` AND credit `V`'s wallet by `amount_cop`
- AND MUST append a `DEPOSITO` entry to `MarketLedger` for `V`
- AND MUST NOT credit again if the same `tx_id` is replayed

#### Scenario: DECLINED webhook leaves no trace
- GIVEN a `MarketTransactions` row in status `PENDING`
- WHEN Wompi sends `transaction.updated` with status `DECLINED`
- THEN the system MUST transition the row to status `DECLINED`
- AND MUST NOT modify any wallet balance or write a ledger entry

#### Scenario: Invalid signature is rejected
- GIVEN a webhook POST whose signature does not match the HMAC-SHA256 of the body
- WHEN `POST /v1/payments/webhook` is called
- THEN the system MUST return HTTP 401
- AND MUST NOT modify any state

### Requirement: Refund Flow

The system MUST support refunds that atomically reverse the original transaction.

#### Scenario: Refund APPROVED transaction
- GIVEN a `MarketTransactions` row in status `APPROVED` AND its `channel` is `WOMPI_CARD`
- WHEN `POST /v1/payments/{id}/refund` is called by an admin (Cognito group `dpo`)
- THEN the system MUST call Wompi refund API
- AND on Wompi success MUST transition the row to `REFUNDED`
- AND MUST write a `REFUND` entry to `MarketLedger` debiting the recipient

### Requirement: Concurrency Safety

The system MUST prevent double-spend via optimistic concurrency.

#### Scenario: Concurrent intent creation on same idempotency key
- GIVEN 2 simultaneous `POST /v1/payments/intent` calls with the same `Idempotency-Key: K1`
- WHEN both arrive at the same time
- THEN exactly ONE MUST succeed (return 200)
- AND the other MUST return HTTP 409

## Files
- `packages/pagos-service/src/api/payments.ts`
- `packages/pagos-service/src/lib/wompi.ts`
- `packages/pagos-service/src/lib/ledger.ts`
- `packages/pagos-service/tests/integration/payment-orchestration.test.ts`