/**
 * Tests for per-deposit hold tracking (PR 7 — closes OPL-CARD-008).
 *
 * Decreto 222/2020 Art. 4 requires per-deposit timestamp tracking for
 * closed-loop wallet withdrawals. Currently the wallet route uses the
 * OLD tier-based `withdrawHoldFor(tier, amount)` logic which violates
 * Decreto 222 for Tier 3-4 (T+0 always, regardless of deposit recency).
 *
 * The fix:
 *   1. Each DEPOSITO ledger entry carries a `held_until` field
 *      (created_at + COOLING_OFF_PERIOD_MS).
 *   2. On withdrawal, query the LedgerTable for the oldest unreleased
 *      DEPOSITO entry (held_until > now).
 *   3. If the oldest entry is within 5 days, REJECT the withdrawal.
 *
 * These tests cover the helpers in src/lib/withdrawal-cooling-off.ts
 * and the new `getOldestUnreleasedDeposit()` lookup function.
 */
import { describe, it, expect } from "vitest";
import {
  COOLING_OFF_DAYS,
  COOLING_OFF_PERIOD_MS,
  isWithinCoolingOff,
  canWithdraw,
  computeHeldUntilIso,
  getOldestUnreleasedDeposit,
} from "../../src/lib/withdrawal-cooling-off";
import { WithdrawHoldNotElapsedError } from "../../src/lib/errors";

describe("withdrawal cooling-off — constants (Decreto 222/2020)", () => {
  it("COOLING_OFF_DAYS = 5 (Decreto 222/2020 Art. 4)", () => {
    expect(COOLING_OFF_DAYS).toBe(5);
  });

  it("COOLING_OFF_PERIOD_MS = 5 days in ms", () => {
    expect(COOLING_OFF_PERIOD_MS).toBe(5 * 24 * 60 * 60 * 1000);
  });
});

describe("computeHeldUntilIso — per-deposit hold timestamp", () => {
  it("returns createdAt + 5 days in ISO format", () => {
    const createdAt = "2026-06-01T12:00:00.000Z";
    const result = computeHeldUntilIso(createdAt);
    const expected = new Date(new Date(createdAt).getTime() + COOLING_OFF_PERIOD_MS).toISOString();
    expect(result).toBe(expected);
  });

  it("throws on empty timestamp", () => {
    expect(() => computeHeldUntilIso("")).toThrow(/createdAtIso/);
  });
});

describe("isWithinCoolingOff — boolean check", () => {
  it("returns true for deposit 1 day old", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const depositIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(isWithinCoolingOff(depositIso, now)).toBe(true);
  });

  it("returns true for deposit exactly 4 days 23h old (just inside window)", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const depositMs = now.getTime() - (COOLING_OFF_PERIOD_MS - 60 * 60 * 1000);
    expect(isWithinCoolingOff(new Date(depositMs).toISOString(), now)).toBe(true);
  });

  it("returns false for deposit exactly 5 days old (just outside window)", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const depositIso = new Date(now.getTime() - COOLING_OFF_PERIOD_MS).toISOString();
    expect(isWithinCoolingOff(depositIso, now)).toBe(false);
  });

  it("returns false for deposit 10 days old", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const depositIso = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(isWithinCoolingOff(depositIso, now)).toBe(false);
  });
});

describe("canWithdraw — main enforcement function", () => {
  const nowIso = "2026-06-10T00:00:00.000Z";

  it("ALLOW: no deposits (defensive default — closed-loop wallets should always have deposits)", () => {
    expect(() =>
      canWithdraw({ userId: "u1", amountCop: 100_000, nowIso }),
    ).not.toThrow();
  });

  it("ALLOW: oldest deposit is 6 days old (past cooling-off)", () => {
    const oldestIso = new Date(new Date(nowIso).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(() =>
      canWithdraw({ userId: "u1", amountCop: 100_000, oldestUnreleasedDepositIso: oldestIso, nowIso }),
    ).not.toThrow();
  });

  it("REJECT: oldest deposit is 2 days old (still within 5-day window)", () => {
    const oldestIso = new Date(new Date(nowIso).getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(() =>
      canWithdraw({ userId: "u1", amountCop: 100_000, oldestUnreleasedDepositIso: oldestIso, nowIso }),
    ).toThrow(WithdrawHoldNotElapsedError);
  });

  it("REJECT error contains available_at timestamp (no balance leak)", () => {
    const oldestIso = new Date(new Date(nowIso).getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    try {
      canWithdraw({ userId: "u1", amountCop: 100_000, oldestUnreleasedDepositIso: oldestIso, nowIso });
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as WithdrawHoldNotElapsedError;
      expect(err.code).toBe("WITHDRAW_HOLD_NOT_ELAPSED");
      expect(err.availableAtIso).toBeDefined();
      // Verify availableAt is 3 days in the future
      const future = new Date(err.availableAtIso).getTime();
      const expected = new Date(oldestIso).getTime() + COOLING_OFF_PERIOD_MS;
      expect(future).toBe(expected);
    }
  });
});

describe("getOldestUnreleasedDeposit — LedgerTable query (closes OPL-CARD-008)", () => {
  it("returns the OLDEST DEPOSITO entry whose held_until > now", async () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const mockQuery = async () => ({
      Items: [
        // Newest first (DDB returns sorted by sk asc by default)
        { user_id: "u1", ts_seq: "2026-06-09#abc", movement: "DEPOSITO", amount_cop: 100_000, held_until: "2026-06-14T00:00:00.000Z", released: false },
        { user_id: "u1", ts_seq: "2026-06-08#def", movement: "DEPOSITO", amount_cop: 200_000, held_until: "2026-06-13T00:00:00.000Z", released: false },
        { user_id: "u1", ts_seq: "2026-06-07#ghi", movement: "DEPOSITO", amount_cop: 50_000, held_until: "2026-06-12T00:00:00.000Z", released: false },
      ],
    });

    const result = await getOldestUnreleasedDeposit(
      { userId: "u1", nowMs: now.getTime() },
      { queryClient: { send: mockQuery } as any, ledgerTableName: "LedgerTable" },
    );

    expect(result).not.toBeNull();
    // The OLDEST deposit (ts_seq=2026-06-07) — even though held_until 2026-06-12 is in the future
    // (because now=2026-06-10), this is the binding constraint
    expect(result!.ts_seq).toBe("2026-06-07#ghi");
    expect(result!.amount_cop).toBe(50_000);
  });

  it("returns null when no deposits exist", async () => {
    const result = await getOldestUnreleasedDeposit(
      { userId: "u1", nowMs: Date.now() },
      { queryClient: { send: async () => ({ Items: [] }) } as any, ledgerTableName: "LedgerTable" },
    );
    expect(result).toBeNull();
  });

  it("returns null when all deposits are released (oldest is filtered out)", async () => {
    const mockQuery = async () => ({
      Items: [
        { user_id: "u1", ts_seq: "2026-06-09#a", movement: "DEPOSITO", amount_cop: 100_000, held_until: "2026-06-14T00:00:00.000Z", released: true },
        { user_id: "u1", ts_seq: "2026-06-08#b", movement: "DEPOSITO", amount_cop: 200_000, held_until: "2026-06-13T00:00:00.000Z", released: false },
      ],
    });
    const result = await getOldestUnreleasedDeposit(
      { userId: "u1", nowMs: new Date("2026-06-10T00:00:00.000Z").getTime() },
      { queryClient: { send: mockQuery } as any, ledgerTableName: "LedgerTable" },
    );
    // The oldest UN-released is 2026-06-08 (the first one was released)
    expect(result!.ts_seq).toBe("2026-06-08#b");
  });

  it("ignores non-DEPOSITO entries (BONUS, TRANSFER_IN, etc.)", async () => {
    const mockQuery = async () => ({
      Items: [
        { user_id: "u1", ts_seq: "2026-06-09#a", movement: "BONUS", amount_cop: 1000, held_until: "2026-06-14T00:00:00.000Z", released: false },
        { user_id: "u1", ts_seq: "2026-06-08#b", movement: "TRANSFER_IN", amount_cop: 5000, held_until: "2026-06-13T00:00:00.000Z", released: false },
        { user_id: "u1", ts_seq: "2026-06-07#c", movement: "DEPOSITO", amount_cop: 50_000, held_until: "2026-06-12T00:00:00.000Z", released: false },
      ],
    });
    const result = await getOldestUnreleasedDeposit(
      { userId: "u1", nowMs: new Date("2026-06-10T00:00:00.000Z").getTime() },
      { queryClient: { send: mockQuery } as any, ledgerTableName: "LedgerTable" },
    );
    // The only DEPOSITO is 2026-06-07
    expect(result!.ts_seq).toBe("2026-06-07#c");
  });
});
