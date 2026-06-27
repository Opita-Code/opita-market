# Spec: bonus-atomicity

## Purpose

Bonus engine has no per-user daily cap (unlimited cashback farming), no atomic claim (race condition in FIRST_PURCHASE), no cooldown enforcement. These are direct financial losses and money-laundering risks. This spec hardens the bonus engine with atomic claims, caps, and proper cooldown.

## Requirements

### R1 — Per-user daily cap
- `maxClaimsPerDay`: 20 (max cashback claims per user per day)
- `maxAmountPerDayCop`: 100,000 (max COP from cashback per user per day)
- `maxAmountPerWeekCop`: 500,000 (for streak bonus)
- Configurable per bonus rule in `bonus-rules.ts`
- Cumulative tracked in new `BonusDailyCounter` table (pk: `user_id:rule_id:date`, ttl: 7 days)

### R2 — Per-user monthly referral cap
- `maxReferralsPerMonth`: 10 QUALIFIED referrals per referrer
- Tracked in `ReferralMonthlyCounter` table
- Exceeded → throw `MONTHLY_REFERRAL_LIMIT_EXCEEDED`

### R3 — Atomic claim
- `BonusStore.recordBonus()` uses `ConditionExpression: attribute_not_exists(pk)` on first-purchase bonuses
- Concurrent first-purchase attempts: only first succeeds, others throw `ConditionFailedError('BONUS_ALREADY_CLAIMED')`
- Idempotency key: `${user_id}:${rule_id}:${transaction_id}` (deterministic)

### R4 — Remove clock injection
- `contextTs` parameter removed from `TriggerRuleInput`
- Production clock always `Date.now()`
- Tests use DI clock via `BonusEngineDeps.now()` (not from caller)
- Caller cannot influence timestamps

### R5 — Required anti-fraud context
- `AntiFraudContext` fields REQUIRED at API layer:
  - `refereeIp`: extracted from `requireUser(c).ip`
  - `refereeDeviceId`: extracted from fingerprinting SDK
  - `referrerIp`, `referrerDeviceId`: from referrer's most recent session
- If IP/device cannot be determined: reject the `acceptCode` call, don't silently pass

### R6 — Bonus reversal on chargeback
- `reverseBonusesForTransaction(transactionId)`:
  - Looks up all bonuses linked to transaction
  - Debits the bonus amount from user wallet (atomic)
  - Marks bonuses as `reversed: true`
- Wired up in webhook-gateway (transaction.reversed event)

## Scenarios

### S1 — Cashback farming
- Attacker makes 100 micro-transactions of 1,000 COP each
- Each triggers 2% = 20 COP cashback
- After 20 transactions: 400 COP earned
- 21st transaction: cap exceeded
- **Expected**: 21st-100th transactions return `DAILY_CLAIM_LIMIT_EXCEEDED`
- **Closes**: OPL-LIB-003, OPL-CARD-005, OPL-CARD-011

### S2 — Concurrent first purchase
- User makes 2 simultaneous first purchases
- Both trigger `FIRST_PURCHASE_CASHBACK`
- **Expected**: First succeeds, second throws `BONUS_ALREADY_CLAIMED`
- **Closes**: OPL-LIB-008, OPL-CARD-019

### S3 — Future timestamp exploit
- Attacker sends bonus trigger with `contextTs: '2099-01-01'`
- **Expected**: 400 with `INVALID_INPUT`, `contextTs` field not accepted
- **Closes**: OPL-CARD-006

### S4 — Self-referral with 10 accounts
- Attacker creates 10 accounts, refers each other
- **Expected**: First QUALIFIED bonus pays, 11+ return `MONTHLY_REFERRAL_LIMIT_EXCEEDED`
- **Closes**: OPL-LIB-009

### S5 — Anti-fraud bypass
- Attacker calls `acceptCode` without `AntiFraudContext`
- **Expected**: 400 with `MISSING_ANTI_FRAUD_CONTEXT`
- **Closes**: OPL-CARD-010

### S6 — Chargeback reversal
- User claims FIRST_PURCHASE_CASHBACK on $10,000 purchase
- 30 days later: chargeback arrives
- **Expected**: Wallet debited $300 (3% of $10k), bonus marked reversed
- **Closes**: bonus reversal hook (was missing)

## Out of Scope

- Bonus A/B testing framework (use feature flags if needed)
- Bonus marketplace (users spending OpiCoin on rewards)
- Tier-based bonus multipliers (existing per-rule multipliers)
