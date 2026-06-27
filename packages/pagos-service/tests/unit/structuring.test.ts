/**
 * Tests for structuring detection (PR 7 — closes OPL-CARD-016).
 *
 * Tier 1 3DS threshold is $200,000 COP. The `requires3DS` function uses
 * STRICT greater-than (`amountCop > threshold`), so an amount of exactly
 * $200,000 COP bypasses 3DS. An attacker can split a $1M payment into
 * five $200,000 payments to evade 3DS detection (structuring).
 *
 * The fix:
 *   - Track per-(sender, recipient) transaction count in the
 *     threshold-boundary range [200_000, 300_000] COP per 24h window.
 *   - If count >= 3, flag for DPO review (STRUCTURING_SUSPECTED signal).
 *   - Does NOT block the immediate transaction — the signal is enough.
 *
 * SECURITY:
 *   - Read-only detection (no mutation).
 *   - No info leak about the counter (the caller logs it for DPO).
 *   - Detection works on APPROVED tx only — PENDING/FAILED don't count.
 */
import { describe, it, expect } from "vitest";
import {
  STRUCTURING_LOWER_BOUND_COP,
  STRUCTURING_UPPER_BOUND_COP,
  STRUCTURING_WINDOW_MS,
  STRUCTURING_THRESHOLD,
  isInBoundaryRange,
  detectStructuring,
} from "../../src/lib/structuring.js";

describe("structuring — constants (closes OPL-CARD-016)", () => {
  it("lower bound = 200_000 COP (Tier 1 3DS threshold)", () => {
    expect(STRUCTURING_LOWER_BOUND_COP).toBe(200_000);
  });

  it("upper bound = 300_000 COP (just above threshold, where structuring can fit)", () => {
    expect(STRUCTURING_UPPER_BOUND_COP).toBe(300_000);
  });

  it("window = 24h", () => {
    expect(STRUCTURING_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("threshold = 3 (3+ transactions in window triggers detection)", () => {
    expect(STRUCTURING_THRESHOLD).toBe(3);
  });
});

describe("isInBoundaryRange — boolean check", () => {
  it("returns true at exactly the lower bound (200_000)", () => {
    expect(isInBoundaryRange(200_000)).toBe(true);
  });

  it("returns true at exactly the upper bound (300_000)", () => {
    expect(isInBoundaryRange(300_000)).toBe(true);
  });

  it("returns true for amounts in [200_000, 300_000]", () => {
    expect(isInBoundaryRange(250_000)).toBe(true);
    expect(isInBoundaryRange(275_000)).toBe(true);
  });

  it("returns false BELOW the lower bound (3DS required, not structuring)", () => {
    expect(isInBoundaryRange(199_999)).toBe(false);
    expect(isInBoundaryRange(150_000)).toBe(false);
  });

  it("returns false ABOVE the upper bound (too large to be structuring)", () => {
    expect(isInBoundaryRange(300_001)).toBe(false);
    expect(isInBoundaryRange(500_000)).toBe(false);
  });
});

describe("detectStructuring — main detection (closes OPL-CARD-016)", () => {
  const nowMs = new Date("2026-06-10T00:00:00.000Z").getTime();

  it("returns null when no recent tx exist", async () => {
    const query = async () => ({ Items: [] });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 250_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    expect(result).toBeNull();
  });

  it("returns null when only 1 tx in boundary range (below threshold)", async () => {
    const query = async () => ({
      Items: [
        { transaction_id: "tx-1", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 1000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 250_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    expect(result).toBeNull();
  });

  it("returns null when only 2 tx in boundary range (below threshold)", async () => {
    const query = async () => ({
      Items: [
        { transaction_id: "tx-1", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 2000).toISOString() },
        { transaction_id: "tx-2", from_user_id: "u1", to_user_id: "u2", amount_cop: 250_000, status: "APPROVED", updated_at: new Date(nowMs - 1000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 250_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    expect(result).toBeNull();
  });

  it("DETECTS structuring when 3 EXISTING tx + current = 4 total in boundary range", async () => {
    // 3 existing tx in window + current = 4 → triggers detection
    const query = async () => ({
      Items: [
        { transaction_id: "tx-1", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 5000).toISOString() },
        { transaction_id: "tx-2", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 3000).toISOString() },
        { transaction_id: "tx-3", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 1000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    expect(result).not.toBeNull();
    expect(result!.count).toBe(3);
    expect(result!.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("DETECTS structuring when 4+ EXISTING tx + current = 5+ total (escalating)", async () => {
    // 4 existing tx + current = 5 → triggers detection
    const query = async () => ({
      Items: [
        { transaction_id: "tx-1", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 7000).toISOString() },
        { transaction_id: "tx-2", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 5000).toISOString() },
        { transaction_id: "tx-3", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 3000).toISOString() },
        { transaction_id: "tx-4", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 1000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    expect(result).not.toBeNull();
    expect(result!.count).toBe(4);
  });

  it("does NOT count tx outside the boundary range", async () => {
    const query = async () => ({
      Items: [
        { transaction_id: "tx-small", from_user_id: "u1", to_user_id: "u2", amount_cop: 100_000, status: "APPROVED", updated_at: new Date(nowMs - 5000).toISOString() },
        { transaction_id: "tx-big", from_user_id: "u1", to_user_id: "u2", amount_cop: 1_000_000, status: "APPROVED", updated_at: new Date(nowMs - 3000).toISOString() },
        { transaction_id: "tx-1", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 1000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    // Only 1 tx is in the boundary range — below threshold
    expect(result).toBeNull();
  });

  it("does NOT count tx from DIFFERENT sender", async () => {
    const query = async () => ({
      Items: [
        { transaction_id: "tx-1", from_user_id: "other-user", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 5000).toISOString() },
        { transaction_id: "tx-2", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 3000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    // Only 1 tx from u1 + current = 2 — below threshold
    expect(result).toBeNull();
  });

  it("does NOT count tx to DIFFERENT recipient", async () => {
    const query = async () => ({
      Items: [
        { transaction_id: "tx-1", from_user_id: "u1", to_user_id: "other-recipient", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 5000).toISOString() },
        { transaction_id: "tx-2", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 3000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    // Only 1 tx to u2 + current = 2 — below threshold
    expect(result).toBeNull();
  });

  it("does NOT count tx outside the 24h window", async () => {
    const query = async () => ({
      Items: [
        { transaction_id: "tx-old", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 25 * 60 * 60 * 1000).toISOString() },
        { transaction_id: "tx-1", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "APPROVED", updated_at: new Date(nowMs - 3000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    // tx-old is outside 24h window, only 1 tx counted + current = 2 — below threshold
    expect(result).toBeNull();
  });

  it("does NOT count tx that are PENDING, DECLINED, or REFUNDED (only APPROVED counts)", async () => {
    const query = async () => ({
      Items: [
        { transaction_id: "tx-pending", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "PENDING", updated_at: new Date(nowMs - 5000).toISOString() },
        { transaction_id: "tx-declined", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "DECLINED", updated_at: new Date(nowMs - 3000).toISOString() },
        { transaction_id: "tx-refunded", from_user_id: "u1", to_user_id: "u2", amount_cop: 200_000, status: "REFUNDED", updated_at: new Date(nowMs - 2000).toISOString() },
      ],
    });
    const result = await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    // 0 APPROVED tx + current = 1 — below threshold
    expect(result).toBeNull();
  });

  it("uses StatusUpdatedAtIndex for efficient query", async () => {
    let capturedCmd: any = null;
    const query = async (cmd: any) => {
      capturedCmd = cmd;
      return { Items: [] };
    };
    await detectStructuring(
      { senderId: "u1", recipientId: "u2", amountCop: 200_000, nowMs },
      { queryClient: { send: query } as any, transactionsTableName: "Transactions" },
    );
    expect(capturedCmd).not.toBeNull();
    expect(capturedCmd.IndexName).toBe("StatusUpdatedAtIndex");
  });
});
