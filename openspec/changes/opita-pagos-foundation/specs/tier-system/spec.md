# Spec: tier-system

## Purpose
Five tiers (0-4) gate receive/withdraw limits, withdrawal hold windows, and 3DS thresholds based on the user's verified KYC state. Promotions require all stated requirements; demotions are not automatic — they require DPO action.

## Requirements

### Requirement: Tier Determination

A user's tier MUST be derived from their `kyc_state` and verified-requirements set, persisted in `MarketWallets.tier`.

#### Scenario: Default tier on signup
- GIVEN a user `U` with only a verified phone number
- WHEN `GET /v1/tier/U` is called
- THEN `tier` MUST be `0` AND the response MUST list `unmet_requirements` for tiers 1-4

#### Scenario: Tier 2 promotion requires Verifik-validated NIT
- GIVEN user `U` with all tier-1 requirements met AND `NIT` validated by Verifik
- WHEN `POST /v1/tier/U/promote` is called with `{target_tier: 2}`
- THEN the system MUST persist `tier=2` AND return success
- AND `MarketWallets.tier` MUST reflect the change

#### Scenario: Promotion without all requirements
- GIVEN user `U` with tier 1 missing selfie
- WHEN `POST /v1/tier/U/promote` is called with `{target_tier: 3}`
- THEN the system MUST reject with HTTP 422 AND `error_code="MISSING_REQUIREMENTS"`
- AND the response MUST list which requirements are unmet

### Requirement: Tier-Aware Limit Surfacing

The system MUST surface tier limits in every balance/tier query response.

#### Scenario: Limits returned in balance query
- GIVEN user `U` with tier=2
- WHEN `GET /v1/wallet/U/balance` is called
- THEN the response MUST include `receive_limit_day_cop: 20000000`, `withdraw_limit_day_cop: 5000000`, `withdraw_hold_hours: 4`

### Requirement: 3DS Threshold per Tier

The system MUST require 3DS for card payments above the tier's threshold.

#### Scenario: Tier 0 requires 3DS for any card payment
- GIVEN user `U` with tier=0 (`threeDsThresholdCop=0`)
- WHEN a card payment intent of `1000` is created
- THEN the Wompi transaction MUST include `require_3ds: true`

#### Scenario: Tier 3 never requires 3DS
- GIVEN user `U` with tier=3
- WHEN a card payment intent of `50000000` is created
- THEN the Wompi transaction MUST NOT include `require_3ds`

### Requirement: Trust Badge Surfacing

Counterparties MUST see the user's trust badge when displayed in lobbies/marketplace.

#### Scenario: Tier 2 badge shown on profile
- GIVEN user `U` with tier=2
- WHEN `GET /v1/users/U/public-profile` is called
- THEN the response MUST include `trust_badge: "Vendedor verificado"`

#### Scenario: Tier 0 has no badge
- GIVEN user `U` with tier=0
- WHEN public profile is fetched
- THEN `trust_badge` MUST be `null`

## Files
- `packages/pagos-service/src/api/tier.ts`
- `packages/pagos-service/src/lib/tiers.ts`
- `packages/pagos-service/tests/unit/tiers.test.ts`
- `packages/pagos-service/tests/integration/tier-promotion.test.ts`