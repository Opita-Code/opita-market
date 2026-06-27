/**
 * Bonus engine for Opita Pagos.
 *
 * Applies bonus rules from bonus-rules.ts with cooldown enforcement,
 * chargeback reversal logic, AND per-user daily caps (PR 2d).
 *
 * DECOUPLED from DynamoDB via the BonusStore + BonusDailyCounter interfaces.
 *
 * FLOW for `triggerRule`:
 *   1. Validate input (userId, ruleId, transactionAmountCop if needed)
 *   2. Check if rule was already applied (one-shot rules → ALREADY_CLAIMED)
 *   3. Check cooldown (DAILY_LOGIN, STREAK, REFERRAL → COOLDOWN_ACTIVE)
 *   4. Check daily caps (PR 2d):
 *      - maxClaimsPerDay → DAILY_CLAIM_LIMIT_EXCEEDED
 *      - maxAmountPerDayCop → DAILY_AMOUNT_LIMIT_EXCEEDED
 *   5. Compute amount (fixed, percentage, or multiplier-only)
 *   6. Record bonus in store + daily counter
 *   7. Return { applied, amountCop, reason, cooldownUntil }
 */

import { BONUS_RULES, computeBonusAmount, getRule } from "./bonus-rules.js";
import type { BonusRuleId } from "../db/tables.js";
import type { BonusDailyCounter } from "./bonus-daily-counter.js";
import {
  DailyAmountLimitExceededError,
  DailyClaimLimitExceededError,
} from "./errors.js";

export interface TriggerRuleInput {
  userId: string;
  ruleId: BonusRuleId;
  transactionAmountCop?: number;
  transactionId?: string;
  // NOTE (PR 2d): contextTs REMOVED — closes OPL-CARD-006 clock injection.
  // Tests must use BonusEngineDeps.now() for deterministic time control.
}

export interface TriggerRuleResult {
  applied: boolean;
  amountCop: number;
  reason:
    | "APPLIED"
    | "ALREADY_CLAIMED"
    | "COOLDOWN_ACTIVE"
    | "DAILY_CLAIM_LIMIT_EXCEEDED"
    | "DAILY_AMOUNT_LIMIT_EXCEEDED"
    | "MISSING_TRANSACTION_AMOUNT"
    | "INVALID";
  cooldownUntil?: string;
}

export interface BonusStoreRecord {
  user_id: string;
  rule_id: BonusRuleId;
  ts: string;
  applied: boolean;
  amount_cop: number;
  cooldown_until?: string;
  transaction_id?: string;
  reversed?: boolean;
  reversed_at?: string;
}

export interface BonusStore {
  getLastBonus(userId: string, ruleId: BonusRuleId): Promise<BonusStoreRecord | null>;
  recordBonus(record: BonusStoreRecord): Promise<void>;
  reverseBonusesForTransaction(transactionId: string): Promise<number>;
}

export interface BonusEngineDeps {
  store: BonusStore;
  /** PR 2d: per-user daily counter (closes OPL-LIB-003, OPL-CARD-011). */
  dailyCounter: BonusDailyCounter;
  /** Optional clock override for tests. */
  now?: () => Date;
}

export class BonusEngine {
  private readonly store: BonusStore;
  private readonly dailyCounter: BonusDailyCounter;
  private readonly now: () => Date;

  constructor(deps: BonusEngineDeps) {
    this.store = deps.store;
    this.dailyCounter = deps.dailyCounter;
    this.now = deps.now ?? (() => new Date());
  }

  async triggerRule(input: TriggerRuleInput): Promise<TriggerRuleResult> {
    // PR 2d: reject any input containing contextTs (closes OPL-CARD-006)
    if ("contextTs" in (input as any)) {
      throw new Error(
        "contextTs is no longer accepted — clock is controlled via BonusEngineDeps.now()",
      );
    }

    // 1. Validate
    if (!input.userId || input.userId.length === 0) {
      throw new Error("userId is required");
    }
    if (!input.ruleId) {
      throw new Error("ruleId is required");
    }
    if (
      input.transactionAmountCop !== undefined &&
      (!Number.isInteger(input.transactionAmountCop) || input.transactionAmountCop < 0)
    ) {
      throw new Error("transactionAmountCop must be a non-negative integer");
    }

    const rule = getRule(input.ruleId); // throws if unknown
    const now = this.now();
    const nowMs = now.getTime();

    // 2. Check one-shot (already claimed)
    const lastBonus = await this.store.getLastBonus(input.userId, input.ruleId);
    if (lastBonus && this.isOneShotRule(rule.cooldownSeconds, rule.id)) {
      const result: TriggerRuleResult = {
        applied: false,
        amountCop: 0,
        reason: "ALREADY_CLAIMED",
      };
      await this.record(input, rule, result, now);
      return result;
    }

    // 3. Check cooldown
    if (lastBonus && rule.cooldownSeconds > 0) {
      const lastTs = new Date(lastBonus.ts).getTime();
      const cooldownMs = rule.cooldownSeconds * 1000;
      const elapsedMs = nowMs - lastTs;
      if (elapsedMs < cooldownMs) {
        const cooldownUntilTs = new Date(lastTs + cooldownMs);
        const result: TriggerRuleResult = {
          applied: false,
          amountCop: 0,
          reason: "COOLDOWN_ACTIVE",
          cooldownUntil: cooldownUntilTs.toISOString(),
        };
        await this.record(input, rule, result, now);
        return result;
      }
    }

    // 4. Compute amount (need it before daily cap check)
    const amount = computeBonusAmount(input.ruleId, {
      transactionAmountCop: input.transactionAmountCop,
    });

    if (amount === 0 && rule.amountCop === 0) {
      // Percentage rule without transaction amount
      const result: TriggerRuleResult = {
        applied: false,
        amountCop: 0,
        reason: "MISSING_TRANSACTION_AMOUNT",
      };
      await this.record(input, rule, result, now);
      return result;
    }

    // 5. PR 2d — daily cap enforcement
    if (rule.maxClaimsPerDay !== undefined || rule.maxAmountPerDayCop !== undefined) {
      const daily = await this.dailyCounter.get({
        userId: input.userId,
        ruleId: input.ruleId,
        nowMs,
      });

      if (
        rule.maxClaimsPerDay !== undefined &&
        daily &&
        daily.claimsCount >= rule.maxClaimsPerDay
      ) {
        throw new DailyClaimLimitExceededError(
          `Daily claim limit exceeded for ${rule.id}`,
          rule.id,
          rule.maxClaimsPerDay,
          daily.claimsCount + 1,
        );
      }

      if (
        rule.maxAmountPerDayCop !== undefined &&
        daily &&
        daily.amountCop + amount > rule.maxAmountPerDayCop
      ) {
        throw new DailyAmountLimitExceededError(
          `Daily amount limit exceeded for ${rule.id}`,
          rule.id,
          rule.maxAmountPerDayCop,
          daily.amountCop + amount,
        );
      }
    }

    // 6. Apply + record
    const result: TriggerRuleResult = {
      applied: true,
      amountCop: amount,
      reason: "APPLIED",
    };
    await this.record(input, rule, result, now);

    // 7. Record daily counter (PR 2d)
    if (rule.maxClaimsPerDay !== undefined || rule.maxAmountPerDayCop !== undefined) {
      await this.dailyCounter.add({
        userId: input.userId,
        ruleId: input.ruleId,
        amountCop: amount,
        nowMs,
      });
    }

    return result;
  }

  /**
   * Reverse all bonuses tied to a transaction (called on refund/chargeback).
   * Returns count of bonuses reversed.
   */
  async reverseBonusesForTransaction(transactionId: string): Promise<number> {
    return this.store.reverseBonusesForTransaction(transactionId);
  }

  /**
   * One-shot rules: rule.cooldownSeconds === 0 AND the rule is not a
   * percentage rule (cashback is per-transaction, NOT one-shot).
   */
  private isOneShotRule(cooldownSeconds: number, ruleId: BonusRuleId): boolean {
    if (cooldownSeconds > 0) return false; // has cooldown, not one-shot
    const isPercentage = ruleId === "PURCHASE_CASHBACK" || ruleId === "FIRST_PURCHASE_CASHBACK";
    return !isPercentage;
  }

  private async record(
    input: TriggerRuleInput,
    rule: ReturnType<typeof getRule>,
    result: TriggerRuleResult,
    now: Date,
  ): Promise<void> {
    const cooldownUntil = result.cooldownUntil;
    await this.store.recordBonus({
      user_id: input.userId,
      rule_id: input.ruleId,
      ts: now.toISOString(),
      applied: result.applied,
      amount_cop: result.amountCop,
      cooldown_until: cooldownUntil,
      transaction_id: input.transactionId,
      reversed: false,
    });
  }
}
