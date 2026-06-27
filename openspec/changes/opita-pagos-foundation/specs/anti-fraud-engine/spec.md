# Spec: anti-fraud-engine

## Purpose
Detect and respond to fraudulent activity by aggregating 12 weighted signals into a single ALLOW/REVIEW/BLOCK decision per operation. Every signal persists with an audit trail. Decisions are deterministic given the same input set.

## Requirements

### Requirement: Signal Collection

The system MUST evaluate all relevant signals before completing a payment-intent or withdrawal operation.

#### Scenario: All signals evaluated for new payment intent
- GIVEN a user `U` submitting a payment intent of `50000` via card
- WHEN the system evaluates the intent
- THEN it MUST evaluate these signals (when data is available): VELOCITY_EXCEEDED, AMOUNT_LIMIT_EXCEEDED, GEO_MISMATCH, TOR_EXIT, VPN_DETECTED, PROXY_DETECTED, DATACENTER_IP, DEVICE_FINGERPRINT_MISMATCH, BLACKLIST_MATCH, CHARGEBACK_HISTORY

#### Scenario: Velocity check fires on burst activity
- GIVEN user `U` has 5 payment intents in the last hour
- WHEN a 6th intent arrives
- THEN a `VELOCITY_EXCEEDED` signal MUST be added with `weight ≥ 0.6`

### Requirement: Weighted Decision

The system MUST aggregate signals into a single decision via the formula: `score = sum(signal.weight for fired signals) / sum(weight if all signals were 1.0)`. Decision is BLOCK if score ≥ 0.7, REVIEW if 0.4 ≤ score < 0.7, ALLOW otherwise.

#### Scenario: Single high-weight signal blocks
- GIVEN a user request that triggers a single `BLACKLIST_MATCH` signal with `weight=0.9`
- WHEN the engine computes the decision
- THEN the decision MUST be `BLOCK`

#### Scenario: Low-weight signals trigger review
- GIVEN signals `{GEO_CITY_MISMATCH: 0.2, SUSPICIOUS_TIMING: 0.3}`
- WHEN the engine computes
- THEN the decision MUST be `REVIEW`

#### Scenario: No signals = allow
- GIVEN a clean request with no signals fired
- WHEN the engine computes
- THEN the decision MUST be `ALLOW`

### Requirement: Decision Application

The system MUST apply the decision before processing the operation.

#### Scenario: BLOCK halts the operation
- GIVEN the engine returns decision `BLOCK`
- WHEN applied to a payment intent
- THEN the system MUST reject the request with HTTP 403 AND `error_code="FRAUD_BLOCKED"`
- AND MUST write a `FraudSignals` row with `decision=BLOCK` AND `acted_on=true`

#### Scenario: REVIEW queues for DPO
- GIVEN the engine returns decision `REVIEW`
- WHEN applied to a payment intent
- THEN the system MUST accept the intent (status PENDING) AND flag it in the DPO dashboard
- AND the webhook handler MUST NOT credit until DPO approves

### Requirement: IP-Based Signals

The system MUST consult the IP geolocation cache for Tor/VPN/proxy/datacenter detection.

#### Scenario: Tor exit blocked
- GIVEN a request from IP `1.2.3.4` which is in the Tor exit list
- WHEN the engine evaluates
- THEN a `TOR_EXIT` signal MUST fire with `weight=1.0`
- AND the decision MUST be `BLOCK`

#### Scenario: Datacenter IP flagged
- GIVEN a request from IP `5.6.7.8` which is in a datacenter ASN (e.g., AWS, GCP, OVH)
- WHEN the engine evaluates
- THEN a `DATACENTER_IP` signal MUST fire with `weight=0.5`

### Requirement: Self-Referral Detection (referrals scope)

The system MUST detect self-referral patterns.

#### Scenario: Same device fingerprint referrer and referee
- GIVEN referrer `A` and referee `B` share the same `device_id`
- WHEN `B` signs up with `A`'s code
- THEN the system MUST mark the referral as `REJECTED`
- AND NOT credit bonuses to either party

## Files
- `packages/pagos-service/src/lib/fraud.ts`
- `packages/pagos-service/src/lib/ip-geolocation.ts`
- `packages/pagos-service/src/db/tables.ts` (FraudSignals type)
- `packages/pagos-service/tests/unit/fraud-engine.test.ts`
- `packages/pagos-service/tests/integration/fraud-decision-flow.test.ts`