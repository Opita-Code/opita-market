import { describe, it, expect } from "vitest";
import { BONUS_RULES, computeBonusAmount, type BonusRuleId, getRule, getCooldownSeconds } from "../../src/lib/bonus-rules.js";

/**
 * Tests for bonus-rules config — 20 typed rules.
 *
 * Each rule has: id, name, amountCop, cooldownSeconds, multiplier, description.
 *
 * The rules file is THE source of truth for all bonus amounts.
 * Adding a new rule = add to BONUS_RULES const, no code change elsewhere.
 */
describe("bonus-rules — config-driven rule registry", () => {
  describe("rule registry completeness", () => {
    it("defines all 20 expected rules", () => {
      const expectedIds: BonusRuleId[] = [
        "WELCOME_CELL_VERIFIED",
        "EMAIL_VERIFIED",
        "PROFILE_COMPLETED",
        "NIT_VERIFIED",
        "KYC_COMPLETED",
        "FIRST_PURCHASE_CASHBACK",
        "PURCHASE_CASHBACK",
        "SELLER_FIRST_SALE",
        "SELLER_REPEAT_SALE",
        "REVIEW_LEFT",
        "REFERRAL_QUALIFIED",
        "REFERRAL_SIGNED_UP",
        "DAILY_LOGIN",
        "STREAK_7_DAYS",
        "STREAK_30_DAYS",
        "BIRTHDAY",
        "ANNIVERSARY",
        "RURAL_HUILA_CHALLENGE",
        "BLACK_FRIDAY_OPITA",
        "TIER_PROMOTION_BONUS",
      ];
      for (const id of expectedIds) {
        expect(BONUS_RULES[id]).toBeDefined();
      }
      expect(Object.keys(BONUS_RULES)).toHaveLength(20);
    });

    it("every rule has non-negative amount (percentage rules use amountCop=0)", () => {
      for (const [id, rule] of Object.entries(BONUS_RULES)) {
        expect(rule.amountCop, `${id}.amountCop`).toBeGreaterThanOrEqual(0);
      }
    });

    it("every rule has a human-readable name", () => {
      for (const [id, rule] of Object.entries(BONUS_RULES)) {
        expect(rule.name, `${id}.name`).toBeTruthy();
        expect(rule.name.length, `${id}.name`).toBeGreaterThan(3);
      }
    });

    it("every rule has a description", () => {
      for (const [id, rule] of Object.entries(BONUS_RULES)) {
        expect(rule.description, `${id}.description`).toBeTruthy();
      }
    });

    it("multiplier is >= 1 (no negative multipliers in base config)", () => {
      for (const [id, rule] of Object.entries(BONUS_RULES)) {
        expect(rule.multiplier, `${id}.multiplier`).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("specific rule values (audit-grade)", () => {
    it("WELCOME_CELL_VERIFIED = 200 (gift on signup)", () => {
      expect(BONUS_RULES.WELCOME_CELL_VERIFIED.amountCop).toBe(200);
    });

    it("NIT_VERIFIED = 1000 (encourage KYC completion)", () => {
      expect(BONUS_RULES.NIT_VERIFIED.amountCop).toBe(1000);
    });

    it("PURCHASE_CASHBACK has 0 cooldown (every purchase)", () => {
      expect(BONUS_RULES.PURCHASE_CASHBACK.cooldownSeconds).toBe(0);
    });

    it("FIRST_PURCHASE_CASHBACK has 3% rate, PURCHASE_CASHBACK has 2% rate (incentive first)", () => {
      // Percentage rules have amountCop=0, but computeBonusAmount applies 3% vs 2%.
      // We verify this via the computeBonusAmount helper.
      const firstAmount = computeBonusAmount("FIRST_PURCHASE_CASHBACK", { transactionAmountCop: 100_000 });
      const regularAmount = computeBonusAmount("PURCHASE_CASHBACK", { transactionAmountCop: 100_000 });
      expect(firstAmount).toBe(3_000); // 3% of 100k
      expect(regularAmount).toBe(2_000); // 2% of 100k
      expect(firstAmount).toBeGreaterThan(regularAmount);
    });

    it("DAILY_LOGIN has 24h cooldown", () => {
      expect(BONUS_RULES.DAILY_LOGIN.cooldownSeconds).toBe(24 * 60 * 60);
    });

    it("STREAK_7_DAYS has higher amount than DAILY_LOGIN", () => {
      expect(BONUS_RULES.STREAK_7_DAYS.amountCop)
        .toBeGreaterThan(BONUS_RULES.DAILY_LOGIN.amountCop);
    });

    it("STREAK_30_DAYS > STREAK_7_DAYS", () => {
      expect(BONUS_RULES.STREAK_30_DAYS.amountCop)
        .toBeGreaterThan(BONUS_RULES.STREAK_7_DAYS.amountCop);
    });

    it("REFERRAL_QUALIFIED = 500, REFERRAL_SIGNED_UP = 200", () => {
      expect(BONUS_RULES.REFERRAL_QUALIFIED.amountCop).toBe(500);
      expect(BONUS_RULES.REFERRAL_SIGNED_UP.amountCop).toBe(200);
    });

    it("BIRTHDAY = 500", () => {
      expect(BONUS_RULES.BIRTHDAY.amountCop).toBe(500);
    });
  });

  describe("getRule helper", () => {
    it("returns the rule for a valid id", () => {
      expect(getRule("WELCOME_CELL_VERIFIED")).toEqual(BONUS_RULES.WELCOME_CELL_VERIFIED);
    });

    it("throws on unknown rule id", () => {
      expect(() => getRule("UNKNOWN_RULE" as BonusRuleId)).toThrow();
    });
  });

  describe("getCooldownSeconds helper", () => {
    it("returns 0 for rules without cooldown", () => {
      expect(getCooldownSeconds("PURCHASE_CASHBACK")).toBe(0);
    });

    it("returns configured cooldown", () => {
      expect(getCooldownSeconds("DAILY_LOGIN")).toBe(24 * 60 * 60);
    });
  });
});