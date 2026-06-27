# Spec: webhook-gateway

## Purpose

Wompi webhook handler is currently a stub that only verifies the signature and returns 200. This spec introduces a complete webhook gateway that handles signature + timestamp + replay + idempotency + state machine transition. The transportadora webhook gets the same treatment.

## Requirements

### R1 — Signature verification (already exists, harden)
- HMAC SHA256 with `crypto.timingSafeEqual`
- Generic `InvalidSignatureError()` (no descriptive message)
- Response: 401 with `error_code: 'INVALID_SIGNATURE'`

### R2 — Timestamp freshness (NEW, closes OPL-LIB-001)
- Wompi sends `timestamp` in seconds
- Compute `Date.now() - body.timestamp * 1000`
- Reject if `> MAX_AGE_MS` (default: 5 minutes)
- Response: 401 with `error_code: 'WEBHOOK_EXPIRED'`

### R3 — Replay protection via idempotency (NEW, closes OPL-API-004)
- New `ProcessedWebhooks` table (pk: `event_id`, ttl: 7 days)
- Before processing: lookup by `event_id`
- If exists: return 200 (idempotent retry, no processing)
- If not: write `event_id` with `ConditionExpression: attribute_not_exists(event_id)` and proceed
- Atomic via single PutCommand

### R4 — Event type dispatch (NEW, closes OPL-CARD-002)
- Parse `body.event` (e.g., `transaction.approved`, `transaction.declined`, `transaction.reversed`)
- Switch on event type:
  - `approved`: call `EscrowStateMachine.transition(tx, 'WOMPI_APPROVED')` + credit wallet if NONE
  - `declined`: mark tx as FAILED in DynamoDB
  - `reversed`: call `reverseBonusesForTransaction(tx.id)`
  - `disputed`: call `EscrowStateMachine.transition(tx, 'WOMPI_CHARGEBACK')`

### R5 — 3DS verification (NEW, closes OPL-CARD-004)
- If `transaction.requires_3ds === true`:
  - Call Wompi API: `GET /v1/transactions/{wompi_tx_id}`
  - Verify `3ds_authentication.authentication_value` is present
  - If missing: log fraud signal, do NOT credit, return 200 (don't retry)
- Cache 3DS verification for 1h to avoid duplicate Wompi calls

### R6 — Transportadora HMAC (NEW, closes OPL-API-002)
- Transportadora webhook accepts `x-transportadora-signature` header
- HMAC SHA256 with per-transportadora secret
- Validate transportadora is authorized for `transaction_id` (logistics table lookup)
- Response: 401 if signature invalid; 403 if transportadora not authorized

### R7 — Body size limit (NEW, closes OPL-API-007)
- Hono configured with `bodyLimit: 102400` (100 KB)
- Larger body → 413

## Scenarios

### S1 — Replayed webhook
- Wompi sends `transaction.approved` for tx-123, event-id: `evt-abc`
- Server processes, writes to ProcessedWebhooks
- Wompi retries (network timeout) with same event-id
- **Expected**: 200 (idempotent), NO double credit
- **Closes**: OPL-LIB-001, OPL-API-004

### S2 — Expired webhook
- Wompi sends webhook with `timestamp: 1 hour ago`
- **Expected**: 401, no processing
- **Closes**: OPL-LIB-001

### S3 — Approved with required 3DS, no auth_value
- Transaction has `requires_3ds: true`
- Wompi webhook arrives with `event: transaction.approved`
- Wompi API call: 3DS auth_value is null
- **Expected**: 200 (don't retry), fraud signal logged, NO credit
- **Closes**: OPL-CARD-004

### S4 — Reversed transaction
- Wompi sends `event: transaction.reversed` (chargeback)
- **Expected**: EscrowStateMachine → REFUNDED, bonus reversal triggered
- **Closes**: OPL-CARD-002 (state machine wiring)

### S5 — Forged webhook
- Attacker sends `event: transaction.approved` with random `signature`
- **Expected**: 401 with `INVALID_SIGNATURE`, no processing
- **Closes**: OPL-LIB-007 (generic messages)

### S6 — Transportadora A tries to confirm transaction for transportadora B
- Webhook arrives with valid HMAC for transportadora A
- But transaction_id is assigned to transportadora B in logistics table
- **Expected**: 403 with `error_code: 'UNAUTHORIZED_TRANSPORTADORA'`
- **Closes**: OPL-API-002

## Out of Scope

- Webhook signing by us (we only receive)
- Webhook payload encryption (HTTPS only)
- Webhook delivery retry configuration (Wompi-side)
