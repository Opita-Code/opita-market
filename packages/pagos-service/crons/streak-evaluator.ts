/**
 * Streak evaluator cron — daily 00:00 COL.
 *
 * For each user with login history, computes the current streak length
 * and fires STREAK_7_DAYS / STREAK_30_DAYS bonuses when thresholds are crossed.
 *
 * Rules:
 *   - Streak = consecutive unique UTC days with at least 1 login
 *   - Reset: gap > 36h between two consecutive logins breaks the streak
 *   - STREAK_7_DAYS fires when streak reaches 7 (once per cycle)
 *   - STREAK_30_DAYS fires when streak reaches 30 (once per cycle)
 *   - Both don't fire in the same run (only the highest threshold)
 */

import { BONUS_RULES } from "../src/lib/bonus-rules.js";

export interface StreakUserLog {
  user_id: string;
  login_dates: string[]; // ISO 8601 timestamps
}

export interface BonusInvoker {
  fireStreakBonus(
    userId: string,
    ruleId: "STREAK_7_DAYS" | "STREAK_30_DAYS",
    amountCop: number,
  ): Promise<void>;
}

export interface StreakEvaluatorDeps {
  bonusInvoker: BonusInvoker;
  /** Hours that may elapse without a login before streak resets. */
  gapThresholdHours?: number;
}

export class StreakEvaluator {
  private readonly bonusInvoker: BonusInvoker;
  private readonly gapThresholdMs: number;

  constructor(deps: StreakEvaluatorDeps) {
    this.bonusInvoker = deps.bonusInvoker;
    this.gapThresholdMs = (deps.gapThresholdHours ?? 36) * 60 * 60 * 1000;
  }

  /**
   * Compute the current streak (in days) for each user.
   * Returns a Map<user_id, streakDays>.
   */
  calculateStreak(users: StreakUserLog[], nowIso: string): Map<string, number> {
    const now = new Date(nowIso).getTime();
    const result = new Map<string, number>();

    for (const user of users) {
      // 1. Deduplicate to unique UTC days
      const days = new Set<string>();
      for (const ts of user.login_dates) {
        const day = ts.slice(0, 10); // YYYY-MM-DD
        days.add(day);
      }

      // 2. Sort days ascending
      const sortedDays = Array.from(days).sort();

      if (sortedDays.length === 0) {
        result.set(user.user_id, 0);
        continue;
      }

      // 3. Walk backward from most recent day, counting consecutive days
      //    that are within `gapThresholdHours` of each other.
      let streak = 1;
      for (let i = sortedDays.length - 1; i > 0; i--) {
        const later = new Date(sortedDays[i] + "T12:00:00Z").getTime(); // noon UTC of that day
        const earlier = new Date(sortedDays[i - 1] + "T12:00:00Z").getTime();
        const gap = later - earlier;

        // Gap must be ≤ 36h (allows logins that span day boundaries)
        if (gap <= this.gapThresholdMs) {
          streak++;
        } else {
          break;
        }
      }

      // 4. Sanity: streak should include today (or yesterday at most)
      const mostRecent = sortedDays[sortedDays.length - 1];
      const mostRecentMs = new Date(mostRecent + "T12:00:00Z").getTime();
      const ageMs = now - mostRecentMs;
      const dayInMs = 24 * 60 * 60 * 1000;
      if (ageMs > 2 * dayInMs) {
        // Last login > 2 days ago — streak broken
        streak = 0;
      }

      result.set(user.user_id, streak);
    }

    return result;
  }

  /**
   * Process all users and fire bonuses for those reaching streak thresholds.
   */
  async runForUsers(users: StreakUserLog[], nowIso: string): Promise<void> {
    const streaks = this.calculateStreak(users, nowIso);

    for (const [userId, streak] of streaks.entries()) {
      if (streak >= 30) {
        await this.bonusInvoker.fireStreakBonus(
          userId,
          "STREAK_30_DAYS",
          BONUS_RULES.STREAK_30_DAYS.amountCop,
        );
      } else if (streak >= 7) {
        await this.bonusInvoker.fireStreakBonus(
          userId,
          "STREAK_7_DAYS",
          BONUS_RULES.STREAK_7_DAYS.amountCop,
        );
      }
    }
  }
}

/**
 * AWS Lambda handler for EventBridge cron.
 * PR 6 wires this to `sst.aws.Cron` schedule `cron(0 0 * * ? *)` (midnight COL).
 */
export async function handler(): Promise<void> {
  // PR 6: load recent logins from DynamoDB, instantiate evaluator, fire bonuses
  throw new Error("Not implemented in PR 5 — wire in PR 6");
}