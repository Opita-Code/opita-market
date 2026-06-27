import { describe, it, expect, beforeEach } from "vitest";
import { BonusEngine, type BonusStore, type BonusEngineDeps, type TriggerRuleInput, type TriggerRuleResult } from "../../src/lib/bonuses.js";
import { InMemoryBonusDailyCounter } from "../../src/lib/bonus-daily-counter.js";
import type { BonusRuleId } from "../../src/db/tables.js";

/**
 * Tests for BonusEngine — applies bonus rules with cooldown + reversal logic.
 *
 * The engine is DECOUPLED from DynamoDB via the BonusStore + BonusDailyCounter
 * interfaces, which are mocked here. Tests focus on logic correctness.
 *
 * PR 2d update: contextTs is REMOVED from TriggerRuleInput — tests must use
 * BonusEngineDeps.now() for deterministic time control.
 */

class FakeBonusStore implements BonusStore {
  private bonuses: Array<{
    user_id: string;
    rule_id: BonusRuleId;
    ts: string;
    applied: boolean;
    amount_cop: number;
    cooldown_until?: string;
    transaction_id?: string;
    reversed?: boolean;
    reversed_at?: string;
  }> = [];

  async getLastBonus(userId: string, ruleId: BonusRuleId) {
    const matches = this.bonuses.filter(
      (b) => b.user_id === userId && b.rule_id === ruleId,
    );
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  async recordBonus(record: any) {
    this.bonuses.push(record);
  }

  async reverseBonusesForTransaction(transactionId: string) {
    let count = 0;
    for (const b of this.bonuses) {
      if (b.transaction_id === transactionId && !b.reversed) {
        b.reversed = true;
        b.reversed_at = new Date().toISOString();
        count++;
      }
    }
    return count;
  }

  // Test helpers
  reset() { this.bonuses = []; }
  all() { return this.bonuses; }
}

describe("bonus engine — triggerRule", () => {
  let store: FakeBonusStore;
  let engine: BonusEngine;
  let fakeNow: { current: number };

  beforeEach(() => {
    store = new FakeBonusStore();
    fakeNow = { current: new Date("2026-06-26T10:00:00Z").getTime() };
    const dailyCounter = new InMemoryBonusDailyCounter(() => fakeNow.current);
    const deps: BonusEngineDeps = { store, dailyCounter, now: () => new Date(fakeNow.current) };
    engine = new BonusEngine(deps);
  });

  describe("fixed-amount rules", () => {
    it("applies WELCOME_CELL_VERIFIED (200 COP) for new user", async () => {
      const result = await engine.triggerRule({
        userId: "user-1",
        ruleId: "WELCOME_CELL_VERIFIED",
      });
      expect(result.applied).toBe(true);
      expect(result.amountCop).toBe(200);
      expect(result.cooldownUntil).toBeUndefined();
      expect(result.reason).toBe("APPLIED");
    });

    it("does NOT apply WELCOME_CELL_VERIFIED twice (one-shot)", async () => {
      await engine.triggerRule({ userId: "user-1", ruleId: "WELCOME_CELL_VERIFIED" });
      const second = await engine.triggerRule({
        userId: "user-1",
        ruleId: "WELCOME_CELL_VERIFIED",
      });
      expect(second.applied).toBe(false);
      expect(second.amountCop).toBe(0);
      expect(second.reason).toBe("ALREADY_CLAIMED");
    });

    it("applies NIT_VERIFIED (1000 COP) once", async () => {
      const result = await engine.triggerRule({
        userId: "user-1",
        ruleId: "NIT_VERIFIED",
      });
      expect(result.applied).toBe(true);
      expect(result.amountCop).toBe(1000);
    });
  });

  describe("percentage rules (cashback)", () => {
    it("applies PURCHASE_CASHBACK at 2% of transaction", async () => {
      const result = await engine.triggerRule({
        userId: "buyer-1",
        ruleId: "PURCHASE_CASHBACK",
        transactionAmountCop: 100_000,
        transactionId: "tx-1",
      });
      expect(result.applied).toBe(true);
      expect(result.amountCop).toBe(2_000); // 2% of 100k
    });

    it("applies FIRST_PURCHASE_CASHBACK at 3% of transaction", async () => {
      const result = await engine.triggerRule({
        userId: "buyer-2",
        ruleId: "FIRST_PURCHASE_CASHBACK",
        transactionAmountCop: 100_000,
        transactionId: "tx-fp-1",
      });
      expect(result.applied).toBe(true);
      expect(result.amountCop).toBe(3_000);
    });

    it("percentage rules don't fire without transactionAmountCop", async () => {
      const result = await engine.triggerRule({
        userId: "buyer-1",
        ruleId: "PURCHASE_CASHBACK",
      });
      expect(result.applied).toBe(false);
      expect(result.reason).toBe("MISSING_TRANSACTION_AMOUNT");
    });

    it("percentage rules tie to a transaction (for reversal)", async () => {
      await engine.triggerRule({
        userId: "buyer-3",
        ruleId: "PURCHASE_CASHBACK",
        transactionAmountCop: 100_000,
        transactionId: "tx-tie-1",
      });
      const bonuses = store.all();
      expect(bonuses).toHaveLength(1);
      expect(bonuses[0].transaction_id).toBe("tx-tie-1");
    });
  });

  describe("cooldown enforcement (uses BonusEngineDeps.now() for clock)", () => {
    it("DAILY_LOGIN has 24h cooldown", async () => {
      fakeNow.current = new Date("2026-06-26T10:00:00Z").getTime();
      const r1 = await engine.triggerRule({
        userId: "user-cooldown-1",
        ruleId: "DAILY_LOGIN",
      });
      expect(r1.applied).toBe(true);

      // 1 hour later: should be in cooldown
      fakeNow.current = new Date("2026-06-26T11:00:00Z").getTime();
      const r2 = await engine.triggerRule({
        userId: "user-cooldown-1",
        ruleId: "DAILY_LOGIN",
      });
      expect(r2.applied).toBe(false);
      expect(r2.reason).toBe("COOLDOWN_ACTIVE");
      expect(r2.cooldownUntil).toBeDefined();
    });

    it("DAILY_LOGIN applies again after 24h cooldown", async () => {
      fakeNow.current = new Date("2026-06-26T10:00:00Z").getTime();
      await engine.triggerRule({
        userId: "user-cooldown-2",
        ruleId: "DAILY_LOGIN",
      });
      // But maxClaimsPerDay=1 also enforces daily cap. Move 25h to clear both.
      fakeNow.current = new Date("2026-06-27T11:00:00Z").getTime();
      const r2 = await engine.triggerRule({
        userId: "user-cooldown-2",
        ruleId: "DAILY_LOGIN",
      });
      expect(r2.applied).toBe(true);
    });

    it("REFERRAL_QUALIFIED has 7d cooldown", async () => {
      fakeNow.current = new Date("2026-06-26T10:00:00Z").getTime();
      await engine.triggerRule({
        userId: "user-cooldown-3",
        ruleId: "REFERRAL_QUALIFIED",
      });
      // 3 days later: still in cooldown (7d required)
      fakeNow.current = new Date("2026-06-29T10:00:00Z").getTime();
      const r2 = await engine.triggerRule({
        userId: "user-cooldown-3",
        ruleId: "REFERRAL_QUALIFIED",
      });
      expect(r2.applied).toBe(false);
      expect(r2.reason).toBe("COOLDOWN_ACTIVE");
    });

    it("different rules have independent cooldowns (PURCHASE_CASHBACK + DAILY_LOGIN same minute)", async () => {
      fakeNow.current = new Date("2026-06-26T10:00:00Z").getTime();
      await engine.triggerRule({
        userId: "user-cooldown-4",
        ruleId: "PURCHASE_CASHBACK",
        transactionAmountCop: 1000,
        transactionId: "tx-cd-1",
      });
      const daily = await engine.triggerRule({
        userId: "user-cooldown-4",
        ruleId: "DAILY_LOGIN",
      });
      expect(daily.applied).toBe(true);
    });
  });

  describe("audit trail", () => {
    it("records every bonus attempt (applied or not) in store", async () => {
      await engine.triggerRule({
        userId: "user-audit-1",
        ruleId: "WELCOME_CELL_VERIFIED",
      });
      await engine.triggerRule({
        userId: "user-audit-1",
        ruleId: "WELCOME_CELL_VERIFIED",
      });
      expect(store.all()).toHaveLength(2);
    });

    it("recorded record includes rule_id, user_id, amount, applied flag", async () => {
      await engine.triggerRule({
        userId: "user-audit-2",
        ruleId: "WELCOME_CELL_VERIFIED",
      });
      const record = store.all()[0];
      expect(record.user_id).toBe("user-audit-2");
      expect(record.rule_id).toBe("WELCOME_CELL_VERIFIED");
      expect(record.amount_cop).toBe(200);
      expect(record.applied).toBe(true);
    });
  });

  describe("chargeback reversal", () => {
    it("reverses cashback when transaction is reversed", async () => {
      await engine.triggerRule({
        userId: "buyer-cb-1",
        ruleId: "PURCHASE_CASHBACK",
        transactionAmountCop: 100_000,
        transactionId: "tx-refund-1",
      });
      expect(store.all()[0].reversed).toBeFalsy();

      const count = await engine.reverseBonusesForTransaction("tx-refund-1");
      expect(count).toBe(1);
      expect(store.all()[0].reversed).toBe(true);
      expect(store.all()[0].reversed_at).toBeDefined();
    });

    it("does NOT reverse WELCOME_CELL_VERIFIED (no transaction linkage)", async () => {
      await engine.triggerRule({
        userId: "user-cb-2",
        ruleId: "WELCOME_CELL_VERIFIED",
      });
      const count = await engine.reverseBonusesForTransaction("non-existent");
      expect(count).toBe(0);
      expect(store.all()[0].reversed).toBeFalsy();
    });

    it("reversing same transaction twice is idempotent", async () => {
      await engine.triggerRule({
        userId: "buyer-cb-3",
        ruleId: "PURCHASE_CASHBACK",
        transactionAmountCop: 100_000,
        transactionId: "tx-cb-idem",
      });
      const c1 = await engine.reverseBonusesForTransaction("tx-cb-idem");
      const c2 = await engine.reverseBonusesForTransaction("tx-cb-idem");
      expect(c1).toBe(1);
      expect(c2).toBe(0); // already reversed
    });
  });

  describe("input validation", () => {
    it("throws on empty userId", async () => {
      await expect(
        engine.triggerRule({ userId: "", ruleId: "WELCOME_CELL_VERIFIED" }),
      ).rejects.toThrow();
    });

    it("throws on unknown rule id", async () => {
      await expect(
        engine.triggerRule({ userId: "u", ruleId: "FAKE_RULE" as BonusRuleId }),
      ).rejects.toThrow();
    });

    it("throws on negative transaction amount", async () => {
      await expect(
        engine.triggerRule({
          userId: "u",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: -1,
          transactionId: "tx",
        }),
      ).rejects.toThrow();
    });
  });
});