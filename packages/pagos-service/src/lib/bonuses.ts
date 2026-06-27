/**
 * Bonus engine for Opita Pagos.
 *
 * Applies bonus rules from bonus-rules.ts with cooldown enforcement and
 * chargeback reversal logic.
 *
 * DECOUPLED from DynamoDB via the BonusStore interface — tests inject a
 * fake store. Production wires it to MarketBonuses table (PR 6).
 *
 * FLOW for `triggerRule`:
 *   1. Validate input (userId, ruleId, transactionAmountCop if needed)
 *   2. Check if rule was already applied (one-shot rules → ALREADY_CLAIMED)
 *   3. Check cooldown (DAILY_LOGIN, STREAK, REFERRAL → COOLDOWN_ACTIVE)
 *   4. Compute amount (fixed, percentage, or multiplier-only)
 *   5. Record bonus in store (always — even rejected attempts for audit)
 *   6. Return { applied, amountCop, reason, cooldownUntil }
 */

import { BONUS_RULES, computeBonusAmount, getRule } from "./bonus-rules.js";
import type { BonusRuleId } from "../db/tables.js";

export interface TriggerRuleInput {
  userId: string;
  ruleId: BonusRuleId;
  transactionAmountCop?: number;
  transactionId?: string;
  /** Override "now" for deterministic tests. */
  contextTs?: string;
}

export interface TriggerRuleResult {
  applied: boolean;
  amountCop: number;
  reason: "APPLIED" | "ALREADY_CLAIMED" | "COOLDOWN_ACTIVE" | "MISSING_TRANSACTION_AMOUNT" | "INVALID";
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
  /** Optional clock override for tests. */
  now?: () => Date;
}

export class BonusEngine {
  private readonly store: BonusStore;
  private readonly now: () => Date;

  constructor(deps: BonusEngineDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
  }

  async triggerRule(input: TriggerRuleInput): Promise<TriggerRuleResult> {
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
    const now = input.contextTs ? new Date(input.contextTs) : this.now();

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
      const elapsedMs = now.getTime() - lastTs;
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

    // 4. Compute amount
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

    // 5. Apply
    const result: TriggerRuleResult = {
      applied: true,
      amountCop: amount,
      reason: "APPLIED",
    };
    await this.record(input, rule, result, now);
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