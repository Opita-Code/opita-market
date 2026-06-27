/**
 * ReferralMonthlyCounter — tracks per-referrer monthly referral counts.
 *
 * Closes OPL-LIB-009 (max 10 referrals per referrer per month).
 *
 * Schema (sst.config.ts):
 *   pk: counter_id = `${referrerUserId}:${YYYY-MM-UTC}`
 *   attrs: claims_count
 *   ttl: 35 days
 */

export interface ReferralMonthlyCounter {
  get(input: { referrerUserId: string; nowMs: number }): Promise<number>;
  add(input: { referrerUserId: string; nowMs: number }): Promise<number>;
}

/** Get UTC YYYY-MM string from epoch ms. */
export function utcMonthString(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Composite key for monthly counter. */
export function monthlyCounterKey(referrerUserId: string, nowMs: number): string {
  return `${referrerUserId}:${utcMonthString(nowMs)}`;
}

/** 35 days TTL — covers end of month + grace. */
export const REFERRAL_MONTHLY_TTL_SEC = 35 * 24 * 60 * 60;

export class InMemoryReferralMonthlyCounter implements ReferralMonthlyCounter {
  private counts = new Map<string, number>();

  async get(input: { referrerUserId: string; nowMs: number }): Promise<number> {
    return this.counts.get(monthlyCounterKey(input.referrerUserId, input.nowMs)) ?? 0;
  }

  async add(input: { referrerUserId: string; nowMs: number }): Promise<number> {
    const key = monthlyCounterKey(input.referrerUserId, input.nowMs);
    const newCount = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, newCount);
    return newCount;
  }

  /** Test helper. */
  clear(): void {
    this.counts.clear();
  }
}
