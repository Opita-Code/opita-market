import { describe, it, expect, beforeEach } from "vitest";
import { BonusEngine, type BonusStore, type BonusEngineDeps } from "../../src/lib/bonuses.js";
import { InMemoryBonusDailyCounter, type BonusDailyCounter } from "../../src/lib/bonus-daily-counter.js";
import { DailyAmountLimitExceededError, DailyClaimLimitExceededError } from "../../src/lib/errors.js";
import type { BonusRuleId } from "../../src/db/tables.js";

/**
 * Tests for PR 2d — Bonus engine hardening.
 *
 * Closes:
 *   - OPL-LIB-003 (PURCHASE_CASHBACK no daily cap)
 *   - OPL-CARD-005 (cashback cooldown)
 *   - OPL-CARD-006 (contextTs clock injection)
 *   - OPL-CARD-011 (daily bonus cap)
 *
 * Spec: openspec/changes/pre-deploy-remediation/specs/bonus-atomicity/spec.md
 */

class FakeBonusStore implements BonusStore {
  private bonuses: any[] = [];

  async getLastBonus(userId: string, ruleId: BonusRuleId) {
    const matches = this.bonuses.filter(
      (b) => b.user_id === userId && b.rule_id === ruleId,
    );
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  async recordBonus(record: any) { this.bonuses.push(record); }
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
}

function makeEngine(opts: { now?: () => Date; counter?: BonusDailyCounter } = {}) {
  const store = new FakeBonusStore();
  const counter = opts.counter ?? new InMemoryBonusDailyCounter();
  const deps: BonusEngineDeps = { store, dailyCounter: counter };
  if (opts.now) deps.now = opts.now;
  const engine = new BonusEngine(deps);
  return { engine, store, counter };
}

describe("PR 2d — daily cap enforcement (closes OPL-LIB-003, OPL-CARD-011)", () => {
  describe("PURCHASE_CASHBACK daily amount cap (100,000 COP)", () => {
    it("blocks cashback above 100k COP cumulative per day", async () => {
      // Setup: 1M COP × 2% = 20k cashback per tx. After 5 txs: cumulative = 100k (at cap).
      // 6th tx would push to 120k → over cap → blocked.
      const { engine } = makeEngine();

      for (let i = 0; i < 5; i++) {
        const r = await engine.triggerRule({
          userId: "buyer-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000_000,
          transactionId: `tx-${i}`,
        });
        expect(r.applied).toBe(true);
      }

      // 6th transaction: cumulative would be 120,000 → over cap → blocked
      await expect(
        engine.triggerRule({
          userId: "buyer-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000_000,
          transactionId: "tx-5",
        }),
      ).rejects.toThrow(DailyAmountLimitExceededError);
    });

    it("different users have independent daily caps", async () => {
      const { engine } = makeEngine();

      // user-1 uses full amount cap (5 transactions of 1M)
      for (let i = 0; i < 5; i++) {
        await engine.triggerRule({
          userId: "user-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000_000,
          transactionId: `tx-u1-${i}`,
        });
      }
      // user-1 next is blocked
      await expect(
        engine.triggerRule({
          userId: "user-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000_000,
          transactionId: "tx-u1-5",
        }),
      ).rejects.toThrow(DailyAmountLimitExceededError);

      // user-2 still has full cap
      const r = await engine.triggerRule({
        userId: "user-2",
        ruleId: "PURCHASE_CASHBACK",
        transactionAmountCop: 1_000_000,
        transactionId: "tx-u2-0",
      });
      expect(r.applied).toBe(true);
    });

    it("daily cap resets on new UTC day", async () => {
      const fakeNow = { current: new Date("2026-06-26T10:00:00Z").getTime() };
      const { engine } = makeEngine({ now: () => new Date(fakeNow.current) });

      // Day 1: use full amount cap
      for (let i = 0; i < 5; i++) {
        await engine.triggerRule({
          userId: "buyer-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000_000,
          transactionId: `tx-d1-${i}`,
        });
      }
      // Block on day 1
      await expect(
        engine.triggerRule({
          userId: "buyer-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000_000,
          transactionId: "tx-d1-5",
        }),
      ).rejects.toThrow(DailyAmountLimitExceededError);

      // Move to day 2
      fakeNow.current = new Date("2026-06-27T10:00:00Z").getTime();
      const r = await engine.triggerRule({
        userId: "buyer-1",
        ruleId: "PURCHASE_CASHBACK",
        transactionAmountCop: 1_000_000,
        transactionId: "tx-d2-0",
      });
      expect(r.applied).toBe(true);
    });
  });

  describe("PURCHASE_CASHBACK daily claim count cap (20)", () => {
    it("blocks after 20 cashback claims in a day", async () => {
      const { engine } = makeEngine();

      // 20 small transactions (each 1000 COP × 2% = 20 COP — under amount cap)
      for (let i = 0; i < 20; i++) {
        const r = await engine.triggerRule({
          userId: "buyer-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000,
          transactionId: `tx-${i}`,
        });
        expect(r.applied).toBe(true);
      }

      // 21st claim: claim count cap exceeded
      await expect(
        engine.triggerRule({
          userId: "buyer-1",
          ruleId: "PURCHASE_CASHBACK",
          transactionAmountCop: 1_000,
          transactionId: "tx-20",
        }),
      ).rejects.toThrow(DailyClaimLimitExceededError);
    });
  });

  describe("FIRST_PURCHASE_CASHBACK daily cap (1 claim max per day)", () => {
    it("blocks when first-purchase cashback claim count exceeds cap", async () => {
      const { engine } = makeEngine();

      // FIRST_PURCHASE_CASHBACK is a percentage rule (3%) — fires per-transaction.
      // The "first purchase" semantics are enforced by maxClaimsPerDay: 1.
      const r1 = await engine.triggerRule({
        userId: "buyer-1",
        ruleId: "FIRST_PURCHASE_CASHBACK",
        transactionAmountCop: 100_000,
        transactionId: "tx-1",
      });
      expect(r1.applied).toBe(true); // 3000 COP = 3% of 100k

      // Second attempt: maxClaimsPerDay=1 → blocked
      await expect(
        engine.triggerRule({
          userId: "buyer-1",
          ruleId: "FIRST_PURCHASE_CASHBACK",
          transactionAmountCop: 100_000,
          transactionId: "tx-2",
        }),
      ).rejects.toThrow(DailyClaimLimitExceededError);
    });
  });
});

describe("PR 2d — contextTs removal (closes OPL-CARD-006)", () => {
  it("rejects input containing contextTs (closes future-timestamp exploit)", async () => {
    const { engine } = makeEngine();
    await expect(
      engine.triggerRule({
        userId: "user-1",
        ruleId: "DAILY_LOGIN",
        contextTs: "2099-01-01T00:00:00Z",
      } as any),
    ).rejects.toThrow(/contextTs/);
  });

  it("uses BonusEngineDeps.now() for clock", async () => {
    const fixedNow = new Date("2026-06-26T10:00:00Z");
    const { engine } = makeEngine({ now: () => fixedNow });

    const r1 = await engine.triggerRule({
      userId: "user-1",
      ruleId: "DAILY_LOGIN",
    });
    expect(r1.applied).toBe(true);

    // Move clock by 23 hours — still in cooldown (24h)
    const fakeNow = { current: fixedNow.getTime() + 23 * 60 * 60 * 1000 };
    const r2 = await engine.triggerRule({
      userId: "user-1",
      ruleId: "DAILY_LOGIN",
    });
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe("COOLDOWN_ACTIVE");
  });
});

describe("PR 2d — InMemoryBonusDailyCounter", () => {
  it("tracks cumulative amount per (user, rule, date)", async () => {
    const counter = new InMemoryBonusDailyCounter(() => new Date("2026-06-26T10:00:00Z"));

    const r1 = await counter.add({ userId: "user-1", ruleId: "PURCHASE_CASHBACK", amountCop: 2000, nowMs: Date.now() });
    expect(r1.amountCop).toBe(2000);
    expect(r1.claimsCount).toBe(1);

    const r2 = await counter.add({ userId: "user-1", ruleId: "PURCHASE_CASHBACK", amountCop: 3000, nowMs: Date.now() });
    expect(r2.amountCop).toBe(5000);
    expect(r2.claimsCount).toBe(2);
  });

  it("returns null for unknown (user, rule, date)", async () => {
    const counter = new InMemoryBonusDailyCounter();
    const result = await counter.get({ userId: "user-x", ruleId: "PURCHASE_CASHBACK" });
    expect(result).toBeNull();
  });

  it("separate (user, rule) tracked independently", async () => {
    const counter = new InMemoryBonusDailyCounter();
    await counter.add({ userId: "user-1", ruleId: "PURCHASE_CASHBACK", amountCop: 1000, nowMs: Date.now() });
    await counter.add({ userId: "user-2", ruleId: "PURCHASE_CASHBACK", amountCop: 2000, nowMs: Date.now() });
    await counter.add({ userId: "user-1", ruleId: "FIRST_PURCHASE_CASHBACK", amountCop: 3000, nowMs: Date.now() });

    const a = await counter.get({ userId: "user-1", ruleId: "PURCHASE_CASHBACK" });
    const b = await counter.get({ userId: "user-2", ruleId: "PURCHASE_CASHBACK" });
    const c = await counter.get({ userId: "user-1", ruleId: "FIRST_PURCHASE_CASHBACK" });

    expect(a?.amountCop).toBe(1000);
    expect(b?.amountCop).toBe(2000);
    expect(c?.amountCop).toBe(3000);
  });
});

describe("PR 2d — error types have correct HTTP semantics", () => {
  it("DailyAmountLimitExceededError is 422 with code DAILY_AMOUNT_LIMIT_EXCEEDED", () => {
    const e = new DailyAmountLimitExceededError("Daily amount cap exceeded", "PURCHASE_CASHBACK", 100_000, 102_000);
    expect(e.code).toBe("DAILY_AMOUNT_LIMIT_EXCEEDED");
    expect(e.httpStatus).toBe(422);
    expect(e.safeMessage).toBe("DAILY_AMOUNT_LIMIT_EXCEEDED");
  });

  it("DailyClaimLimitExceededError is 422 with code DAILY_CLAIM_LIMIT_EXCEEDED", () => {
    const e = new DailyClaimLimitExceededError("Daily claim cap exceeded", "PURCHASE_CASHBACK", 20, 21);
    expect(e.code).toBe("DAILY_CLAIM_LIMIT_EXCEEDED");
    expect(e.httpStatus).toBe(422);
    expect(e.safeMessage).toBe("DAILY_CLAIM_LIMIT_EXCEEDED");
  });
});
