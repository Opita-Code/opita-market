# Spec: anti-chargeback-escrow

## Purpose
Protect vendors from chargeback fraud while giving buyers a fair dispute window. Card payments are held in escrow until the buyer confirms receipt OR the dispute window expires. Bre-B payments are released instantly (A2A is irreversible — no chargeback possible).

## Requirements

### Requirement: Card Payment Escrow

Card payments MUST be held in escrow for a configurable window (default 72h after delivery confirmation).

#### Scenario: New card payment starts in escrow
- GIVEN a card payment via Wompi status APPROVED
- WHEN the webhook fires
- THEN the system MUST mark `MarketTransactions.escrow_state="HELD"`
- AND the seller MUST NOT be able to withdraw these funds until release

#### Scenario: Escrow release on delivery confirmation
- GIVEN a card payment in escrow for transaction `T1`
- WHEN the transportadora webhook `POST /v1/delivery/confirm` arrives with `{transaction_id: T1, signature: valid}`
- THEN the system MUST transition `escrow_state` from `HELD` to `RELEASED`
- AND MUST start the `dispute_window_ends_at` timer (now + 72h)
- AND the seller MUST be able to withdraw the funds

### Requirement: Bre-B Instant Release

Bre-B payments MUST be released instantly — there is no chargeback risk.

#### Scenario: Bre-B payment released immediately
- GIVEN a payment via Wompi with channel `WOMPI_BREB` status APPROVED
- WHEN the webhook fires
- THEN `escrow_state` MUST be `RELEASED` immediately
- AND no dispute window applies

### Requirement: Dispute Window

The buyer MUST have a configurable window (default 72h) after delivery to dispute.

#### Scenario: Buyer disputes within window
- GIVEN a card payment `T1` with `dispute_window_ends_at = 2026-06-29T12:00:00Z`
- WHEN buyer calls `POST /v1/payments/T1/dispute` at `2026-06-29T10:00:00Z` with reason + evidence
- THEN the system MUST mark `escrow_state="DISPUTED"`
- AND notify the DPO via SES
- AND freeze the funds until DPO resolves

#### Scenario: Dispute after window expires
- GIVEN the dispute window for `T1` ended at `2026-06-29T12:00:00Z`
- WHEN a dispute attempt arrives at `2026-06-30T10:00:00Z`
- THEN the system MUST reject with HTTP 422 AND `error_code="DISPUTE_WINDOW_CLOSED"`

### Requirement: Evidence-of-Delivery Requirement

The seller MUST submit evidence of delivery for card payments > $1M COP.

#### Scenario: Missing evidence blocks escrow release
- GIVEN a card payment `T1` of `2000000` with status APPROVED, escrow HELD
- WHEN the transportadora webhook fires WITHOUT evidence fields (photo_url, signature_png, etc.)
- THEN the system MUST reject the confirmation with HTTP 422 AND `error_code="EVIDENCE_REQUIRED"`

#### Scenario: Valid evidence releases escrow
- GIVEN evidence `{photo_url, signature_png, delivered_at, recipient_name}` is present
- WHEN the webhook fires
- THEN escrow MUST be released

### Requirement: 3DS Enforcement by Tier

The system MUST require 3DS for card payments above the tier threshold.

#### Scenario: Tier 1 user attempts $300k card payment
- GIVEN user `U` with tier=1 (`threeDsThresholdCop=200000`)
- WHEN `POST /v1/payments/intent` is called with `amount_cop=300000, channel=WOMPI_CARD`
- THEN the Wompi transaction MUST include `require_3ds: true`

### Requirement: Chargeback Auto-Reversal

When Wompi reports a chargeback, the system MUST auto-reverse the transaction and any related bonuses.

#### Scenario: Chargeback reverses transaction + bonuses
- GIVEN a card payment `T1` APPROVED that credited cashback to buyer
- WHEN Wompi webhook fires with `event="transaction.updated" status="DECLINED" reason="CHARGEBACK"`
- THEN the system MUST transition `T1.status="REFUNDED"`
- AND MUST write `REFUND: -amount` to seller's ledger
- AND MUST reverse any `MarketBonuses` row tied to `T1`

## Files
- `packages/pagos-service/src/lib/escrow.ts`
- `packages/pagos-service/src/api/delivery.ts` (transportadora webhook)
- `packages/pagos-service/src/lib/wompi.ts` (chargeback event handling)
- `packages/pagos-service/tests/integration/escrow-flow.test.ts`
- `packages/pagos-service/tests/integration/chargeback-reversal.test.ts`