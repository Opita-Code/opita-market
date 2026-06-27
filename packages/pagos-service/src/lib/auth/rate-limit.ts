/**
 * Rate limiter.
 *
 * - RATE_LIMITS: per-role limits from spec (R5).
 * - InMemoryRateLimiter: for tests + single-instance Lambda.
 * - Production: backed by Redis (already in stack) — implement RedisRateLimiter
 *   in a follow-up PR. The interface is the same.
 */

import type { RateLimiter } from "./types.js";

export const RATE_LIMITS = {
  user: { max: 60, windowMs: 60_000 },
  merchant: { max: 300, windowMs: 60_000 },
  dpo: { max: 600, windowMs: 60_000 },
  admin: { max: 600, windowMs: 60_000 },
  anonymous: { max: 20, windowMs: 60_000 },
} as const;

export class InMemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  async check(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt < now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }
    if (existing.count >= max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }
    existing.count += 1;
    return { allowed: true };
  }

  /** Test helper: clear all windows. */
  reset(): void {
    this.windows.clear();
  }
}
