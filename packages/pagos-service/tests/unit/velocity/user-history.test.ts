import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryUserHistory,
  type UserHistory,
} from "../../../src/lib/velocity/user-history.js";

/**
 * Tests for UserHistory (PR 2c — closes OPL-CARD-012 repeat offender).
 *
 * Spec (velocity-counter/spec.md):
 *   - New `UserHistory` table (pk: user_id, ttl: 30 days)
 *   - After every BLOCK decision, write user_id with reason + timestamp
 *   - Before evaluating signals, lookup UserHistory for prior BLOCKs
 *   - If found and not expired: auto-BLOCK without signal evaluation
 */
describe("user history — first-time lookup", () => {
  let history: UserHistory;

  beforeEach(() => {
    history = new InMemoryUserHistory();
  });

  it("returns null for user with no history", async () => {
    const block = await history.findRecentBlock("user-123");
    expect(block).toBeNull();
  });

  it("returns null for user with non-block history (e.g., REVIEW)", async () => {
    await history.recordDecision({
      userId: "user-123",
      decision: "REVIEW",
      reason: "GEO_MISMATCH",
      timestampMs: Date.now(),
    });
    const block = await history.findRecentBlock("user-123");
    expect(block).toBeNull();
  });
});

describe("user history — block lookup", () => {
  let history: UserHistory;

  beforeEach(() => {
    history = new InMemoryUserHistory();
  });

  it("returns block entry for user with prior BLOCK", async () => {
    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "TOR_EXIT",
      timestampMs: Date.now(),
    });
    const block = await history.findRecentBlock("user-123");
    expect(block).not.toBeNull();
    expect(block?.userId).toBe("user-123");
    expect(block?.reason).toBe("TOR_EXIT");
  });

  it("returns most recent block when multiple exist", async () => {
    const now = Date.now();
    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "TOR_EXIT",
      timestampMs: now - 60_000,
    });
    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "BLACKLIST_MATCH",
      timestampMs: now,
    });
    const block = await history.findRecentBlock("user-123");
    expect(block?.reason).toBe("BLACKLIST_MATCH");
  });

  it("does not return blocks for other users", async () => {
    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "TOR_EXIT",
      timestampMs: Date.now(),
    });
    const block = await history.findRecentBlock("user-456");
    expect(block).toBeNull();
  });
});

describe("user history — TTL expiry (30 days)", () => {
  it("returns null when block is older than 30 days", async () => {
    const fakeNow = { current: 100_000_000_000 }; // arbitrary large ms
    const history = new InMemoryUserHistory(() => fakeNow.current);
    const thirtyOneDaysAgo = fakeNow.current - 31 * 24 * 60 * 60 * 1000;
    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "TOR_EXIT",
      timestampMs: thirtyOneDaysAgo,
    });
    const block = await history.findRecentBlock("user-123");
    expect(block).toBeNull();
  });

  it("returns block within 30 days", async () => {
    const fakeNow = { current: 100_000_000_000 };
    const history = new InMemoryUserHistory(() => fakeNow.current);
    const twentyNineDaysAgo = fakeNow.current - 29 * 24 * 60 * 60 * 1000;
    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "TOR_EXIT",
      timestampMs: twentyNineDaysAgo,
    });
    const block = await history.findRecentBlock("user-123");
    expect(block).not.toBeNull();
  });
});

describe("user history — recordDecision validation", () => {
  it("rejects empty userId", async () => {
    const history = new InMemoryUserHistory();
    await expect(
      history.recordDecision({
        userId: "",
        decision: "BLOCK",
        reason: "TOR_EXIT",
        timestampMs: Date.now(),
      }),
    ).rejects.toThrow();
  });

  it("rejects empty reason", async () => {
    const history = new InMemoryUserHistory();
    await expect(
      history.recordDecision({
        userId: "user-123",
        decision: "BLOCK",
        reason: "",
        timestampMs: Date.now(),
      }),
    ).rejects.toThrow();
  });

  it("rejects negative timestamp", async () => {
    const history = new InMemoryUserHistory();
    await expect(
      history.recordDecision({
        userId: "user-123",
        decision: "BLOCK",
        reason: "TOR_EXIT",
        timestampMs: -1,
      }),
    ).rejects.toThrow();
  });
});
