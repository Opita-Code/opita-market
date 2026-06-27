import { describe, it, expect, beforeEach } from "vitest";
import { StreakEvaluator, type StreakUserLog, type BonusInvoker } from "../../../crons/streak-evaluator.js";
import { BONUS_RULES } from "../../../src/lib/bonus-rules.js";

/**
 * Tests for the streak-evaluator cron (daily 00:00 COL).
 *
 * Fires STREAK_7_DAYS bonus when user has logged in 7 consecutive days.
 * Fires STREAK_30_DAYS bonus when user has logged in 30 consecutive days.
 *
 * Reset rule: a gap of >36h between logins breaks the streak.
 */

class FakeLog implements BonusInvoker {
  public calls: Array<{ userId: string; ruleId: string; amountCop: number }> = [];
  async fireStreakBonus(userId: string, ruleId: "STREAK_7_DAYS" | "STREAK_30_DAYS", amountCop: number): Promise<void> {
    this.calls.push({ userId, ruleId, amountCop });
  }
}

function makeUsers(...logins: Array<{ user_id: string; dates: string[] }>): StreakUserLog[] {
  return logins.map((l) => ({
    user_id: l.user_id,
    login_dates: l.dates,
  }));
}

describe("streak-evaluator cron", () => {
  let bonusLog: FakeLog;
  let evaluator: StreakEvaluator;

  beforeEach(() => {
    bonusLog = new FakeLog();
    evaluator = new StreakEvaluator({ bonusInvoker: bonusLog });
  });

  describe("streak calculation", () => {
    it("returns 7 for user who logged in 7 consecutive days", () => {
      const dates = [
        "2026-06-20T08:00:00Z",
        "2026-06-21T08:00:00Z",
        "2026-06-22T08:00:00Z",
        "2026-06-23T08:00:00Z",
        "2026-06-24T08:00:00Z",
        "2026-06-25T08:00:00Z",
        "2026-06-26T08:00:00Z",
      ];
      const streak = evaluator.calculateStreak(makeUsers({ user_id: "u", dates }), "2026-06-26T23:00:00Z");
      expect(streak.get("u")).toBe(7);
    });

    it("returns 30 for 30 consecutive days", () => {
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date("2026-06-26T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - (29 - i));
        dates.push(d.toISOString());
      }
      const streak = evaluator.calculateStreak(makeUsers({ user_id: "u", dates }), "2026-06-26T12:00:00Z");
      expect(streak.get("u")).toBe(30);
    });

    it("returns 6 if user logged in 6 days (not yet 7)", () => {
      const dates = [
        "2026-06-21T08:00:00Z",
        "2026-06-22T08:00:00Z",
        "2026-06-23T08:00:00Z",
        "2026-06-24T08:00:00Z",
        "2026-06-25T08:00:00Z",
        "2026-06-26T08:00:00Z",
      ];
      const streak = evaluator.calculateStreak(makeUsers({ user_id: "u", dates }), "2026-06-26T23:00:00Z");
      expect(streak.get("u")).toBe(6);
    });

    it("resets streak when a day is missed", () => {
      const dates = [
        "2026-06-20T08:00:00Z",
        "2026-06-21T08:00:00Z",
        // 22nd MISSED
        "2026-06-23T08:00:00Z",
        "2026-06-24T08:00:00Z",
        "2026-06-25T08:00:00Z",
        "2026-06-26T08:00:00Z",
      ];
      const streak = evaluator.calculateStreak(makeUsers({ user_id: "u", dates }), "2026-06-26T23:00:00Z");
      // 4 consecutive days at the end (23-26)
      expect(streak.get("u")).toBe(4);
    });

    it("handles multiple logins same day as 1 day", () => {
      const dates = [
        "2026-06-26T08:00:00Z",
        "2026-06-26T14:00:00Z",
        "2026-06-26T22:00:00Z",
      ];
      const streak = evaluator.calculateStreak(makeUsers({ user_id: "u", dates }), "2026-06-26T23:00:00Z");
      expect(streak.get("u")).toBe(1);
    });
  });

  describe("bonus firing (cron behavior)", () => {
    it("fires STREAK_7_DAYS bonus when streak = 7", async () => {
      const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-06-26T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - (6 - i));
        return d.toISOString();
      });
      await evaluator.runForUsers(
        makeUsers({ user_id: "u", dates }),
        "2026-06-26T23:00:00Z",
      );
      expect(bonusLog.calls).toContainEqual({ userId: "u", ruleId: "STREAK_7_DAYS", amountCop: 50 });
    });

    it("fires STREAK_30_DAYS bonus when streak = 30", async () => {
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date("2026-06-26T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - (29 - i));
        dates.push(d.toISOString());
      }
      await evaluator.runForUsers(
        makeUsers({ user_id: "u", dates }),
        "2026-06-26T23:00:00Z",
      );
      // STREAK_30_DAYS is fired; STREAK_7_DAYS already paid in a prior run (not re-fired)
      expect(bonusLog.calls.some((c) => c.ruleId === "STREAK_30_DAYS" && c.userId === "u")).toBe(true);
    });

    it("does NOT fire bonus when streak < 7", async () => {
      await evaluator.runForUsers(
        makeUsers({ user_id: "u", dates: ["2026-06-26T08:00:00Z"] }),
        "2026-06-26T23:00:00Z",
      );
      expect(bonusLog.calls).toHaveLength(0);
    });

    it("does NOT fire both bonuses for the same user in one run (only the highest)", async () => {
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date("2026-06-26T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - (29 - i));
        dates.push(d.toISOString());
      }
      await evaluator.runForUsers(
        makeUsers({ user_id: "u", dates }),
        "2026-06-26T23:00:00Z",
      );
      // STREAK_30_DAYS is fired; STREAK_7_DAYS is NOT (already paid in prior 7-day cycle)
      const userCalls = bonusLog.calls.filter((c) => c.userId === "u");
      expect(userCalls.length).toBe(1);
      expect(userCalls[0].ruleId).toBe("STREAK_30_DAYS");
    });
  });
});