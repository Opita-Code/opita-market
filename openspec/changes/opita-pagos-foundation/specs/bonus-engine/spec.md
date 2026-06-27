# Spec: bonus-engine

## Purpose
A configurable engine that credits engagement bonuses to wallets based on real user actions. Each rule has a cooldown to prevent abuse. Bonuses are NEVER credited for transactions later flagged for chargeback.

## Requirements

### Requirement: Welcome Bonus

A new user MUST receive a welcome bonus upon phone verification.

#### Scenario: First phone verification triggers welcome bonus
- GIVEN a user `U` with no prior bonuses AND a verified phone number
- WHEN `POST /v1/bonuses/U/trigger` is called with `{rule_id: "WELCOME_CELL_VERIFIED"}`
- THEN 200 units MUST be credited to `U`'s wallet
- AND a `MarketBonuses` row MUST be appended with `applied=true`, `amount_cop=200`

#### Scenario: Welcome bonus cannot fire twice
- GIVEN user `U` already received `WELCOME_CELL_VERIFIED` bonus
- WHEN the same trigger fires again
- THEN the system MUST NOT credit again
- AND MUST write a `MarketBonuses` row with `applied=false`, `reason="ALREADY_CLAIMED"`

### Requirement: Cashback on Purchases

The system MUST credit a percentage of every approved purchase back to the buyer as a bonus.

#### Scenario: 3% cashback on a purchase
- GIVEN user `U` makes a purchase of `10000` via Wompi (status APPROVED)
- WHEN the webhook fires
- THEN a `PURCHASE_CASHBACK` bonus MUST be applied: 200 units credited (3% of 10000)
- AND the ledger MUST show two entries: `DEPOSITO: 10000` (to seller) and `BONUS: 200` (to buyer)

#### Scenario: First purchase gets 3% (already covered by first_purchase_cashback rule)
- GIVEN user `U` is making their first purchase ever
- WHEN the webhook fires
- THEN `FIRST_PURCHASE_CASHBACK` MUST apply (3%)
- AND `PURCHASE_CASHBACK` MUST NOT double-fire (the engine uses `is_first_purchase` flag)

### Requirement: Streak Bonuses

The system MUST credit streak bonuses based on consecutive daily logins.

#### Scenario: 7-day streak
- GIVEN user `U` has logged in 7 consecutive days
- WHEN the streak evaluator runs at 00:00 COL
- THEN a `STREAK_7_DAYS` bonus of 50 units MUST be applied

#### Scenario: 30-day streak
- GIVEN user `U` has logged in 30 consecutive days
- WHEN the streak evaluator runs
- THEN both `STREAK_7_DAYS` (already paid) MUST NOT re-fire
- AND `STREAK_30_DAYS` MUST fire with 500 units

### Requirement: Chargeback Reversal

The system MUST reverse any bonus credited from a transaction that later becomes `REFUNDED`.

#### Scenario: Bonus reversed on refund
- GIVEN a purchase of `10000` that credited `PURCHASE_CASHBACK` of `200` to user `U`
- WHEN the transaction is later refunded
- THEN the system MUST write a `COMISION: -200` ledger entry debiting `U`
- AND the `MarketBonuses` row MUST be marked `reversed=true`, `reversed_at=<ts>`

### Requirement: Rule Cooldowns

Each rule MUST have a cooldown window to prevent rapid-fire abuse.

#### Scenario: REFERRAL_QUALIFIED cooldown
- GIVEN user `U` already paid `REFERRAL_QUALIFIED` bonus today
- WHEN the rule fires again (e.g., another referred user qualifies)
- THEN the system MUST apply `U` IF cooldown (e.g., 7 days) has elapsed
- ELSE MUST mark `applied=false` with `reason="COOLDOWN_ACTIVE"`

### Requirement: Config-Driven Rules

Bonus rules MUST live in a config file (`packages/pagos-service/src/lib/bonus-rules.ts`) so they can be adjusted without code deploys.

#### Scenario: All rules loaded from config
- GIVEN `bonus-rules.ts` exports a `RULES` array
- WHEN the bonus engine boots
- THEN it MUST load every rule from that array
- AND adding a new rule MUST require only a code change to the file (not a DB migration)

## Files
- `packages/pagos-service/src/lib/bonuses.ts`
- `packages/pagos-service/src/lib/bonus-rules.ts`
- `packages/pagos-service/tests/unit/bonus-engine.test.ts`
- `packages/pagos-service/tests/integration/bonus-on-purchase.test.ts`