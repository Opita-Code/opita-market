# Spec: referrals-engine

## Purpose
Two-sided referral bonuses that reward both referrer and referee, with QUALIFIED state gated by real action (not just signup). Anti-fraud integration prevents self-referral and IP/device-based duplicates.

## Requirements

### Requirement: Referral Code Generation

Every user MUST have a unique referral code at signup.

#### Scenario: Code generated on first wallet access
- GIVEN user `U` accessing their wallet for the first time
- WHEN the wallet row is created
- THEN a `referral_code` of length 8 (alphanumeric, no ambiguous chars) MUST be generated
- AND stored in `MarketWallets.referral_code`

### Requirement: Referral Acceptance

A new user MUST be able to enter a referrer's code at signup.

#### Scenario: Valid code accepted at signup
- GIVEN user `B` enters referrer code `ABC12345`
- WHEN the signup completes
- THEN a `MarketReferrals` row MUST be created with `referrer=A, referee=B, status=PENDING`

#### Scenario: Invalid code rejected
- GIVEN user `B` enters code `INVALID_`
- WHEN signup completes
- THEN no `MarketReferrals` row MUST be created
- AND the response MUST NOT reveal whether the code exists (privacy)

### Requirement: Qualification Triggers Bonus

A referral becomes `QUALIFIED` when the referee makes a first qualifying purchase OR receives a first payment above $10k COP.

#### Scenario: First purchase qualifies
- GIVEN referral `R` in `PENDING` for referee `B`
- WHEN `B` makes a purchase of `5000` (status APPROVED)
- THEN `R.status` MUST become `QUALIFIED`
- AND `R.qualified_at` MUST be set to now

#### Scenario: First incoming payment qualifies
- GIVEN referral `R` for referee `B`
- WHEN `B` receives a payment of `50000` (e.g., as a seller) status APPROVED
- THEN `R.status` MUST become `QUALIFIED`

### Requirement: Bonus Payment

Once QUALIFIED, the bonus MUST be paid to both parties.

#### Scenario: Both parties receive bonus on qualification
- GIVEN referral `R` becomes `QUALIFIED`
- WHEN the bonus engine runs
- THEN the referrer `A` MUST receive `500` units (`REFERRAL_QUALIFIED` bonus)
- AND the referee `B` MUST receive `200` units (`REFERRAL_SIGNED_UP` bonus — fired at QUALIFIED, not signup, to prevent abuse)
- AND `R.status` MUST become `PAID`

### Requirement: Anti-Fraud Integration

The system MUST block self-referrals and IP-based duplicates.

#### Scenario: Self-referral blocked
- GIVEN user `A` enters their OWN code at signup
- WHEN signup completes
- THEN the system MUST NOT create a `MarketReferrals` row
- AND MUST write a `SUSPICIOUS_ACTIVITY` row in `FraudSignals`

#### Scenario: Same IP referrer + referee blocked
- GIVEN referrer `A` from IP `1.2.3.4` invites referee `B`
- WHEN `B` signs up from IP `1.2.3.4`
- THEN the system MUST mark the referral as `REJECTED` with reason `IP_DUPLICATE`

#### Scenario: Same device fingerprint blocked
- GIVEN referrer `A` and referee `B` share `device_id="d-abc"`
- WHEN `B` signs up with `A`'s code
- THEN the system MUST reject the referral

### Requirement: One-Way Bonus Reversibility

If the qualifying transaction is later reversed (refund/chargeback), the bonuses MUST be reversed.

#### Scenario: Bonus reversed on refund
- GIVEN referral `R` paid out, referee `B` then refunds the qualifying purchase
- WHEN the refund processes
- THEN `REFERRAL_QUALIFIED` and `REFERRAL_SIGNED_UP` bonuses MUST be reversed
- AND `R.status` MUST become `REJECTED`

## Files
- `packages/pagos-service/src/api/referrals.ts`
- `packages/pagos-service/src/lib/referrals.ts`
- `packages/pagos-service/src/lib/bonuses.ts` (referral bonus rules)
- `packages/pagos-service/tests/integration/referral-flow.test.ts`
- `packages/pagos-service/tests/integration/referral-anti-fraud.test.ts`