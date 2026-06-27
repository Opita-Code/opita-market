/**
 * BonusDailyCounter — tracks per-user, per-rule cumulative cashback per day.
 *
 * Closes OPL-LIB-003, OPL-CARD-011 (daily cap enforcement).
 *
 * Semantics:
 *   - Composite key: `${userId}:${ruleId}:${YYYY-MM-DD}` (UTC date)
 *   - get(): returns current cumulative amount + claim count
 *   - add(): atomically increments both amount and claim count
 *   - ttlEpoch: 7 days from creation (DynamoDB auto-deletes)
 *
 * Decoupled from DynamoDB via interface — InMemory impl for tests.
 */

export interface DailyCounterInput {
  userId: string;
  ruleId: string;
  amountCop: number;
  nowMs: number;
}

export interface DailyCounterState {
  amountCop: number;
  claimsCount: number;
}

export interface BonusDailyCounter {
  get(input: { userId: string; ruleId: string; nowMs?: number }): Promise<DailyCounterState | null>;
  add(input: DailyCounterInput): Promise<DailyCounterState>;
}

/** Get UTC date string YYYY-MM-DD from epoch ms. */
export function utcDateString(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Composite key for daily counter. */
export function dailyCounterKey(userId: string, ruleId: string, nowMs: number): string {
  return `${userId}:${ruleId}:${utcDateString(nowMs)}`;
}

/** 7 days TTL in seconds (spec R1). */
export const DAILY_COUNTER_TTL_SEC = 7 * 24 * 60 * 60;

export class InMemoryBonusDailyCounter implements BonusDailyCounter {
  private counters = new Map<string, DailyCounterState>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  async get(input: { userId: string; ruleId: string; nowMs?: number }): Promise<DailyCounterState | null> {
    const nowMs = input.nowMs ?? this.clock();
    const key = dailyCounterKey(input.userId, input.ruleId, nowMs);
    return this.counters.get(key) ?? null;
  }

  async add(input: DailyCounterInput): Promise<DailyCounterState> {
    const key = dailyCounterKey(input.userId, input.ruleId, input.nowMs);
    const existing = this.counters.get(key) ?? { amountCop: 0, claimsCount: 0 };
    const updated: DailyCounterState = {
      amountCop: existing.amountCop + input.amountCop,
      claimsCount: existing.claimsCount + 1,
    };
    this.counters.set(key, updated);
    return updated;
  }

  /** Test helper. */
  clear(): void {
    this.counters.clear();
  }
}
