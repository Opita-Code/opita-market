import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCounter } from "../../../src/lib/velocity/counter.js";
import type { VelocityCounter } from "../../../src/lib/velocity/types.js";

/**
 * Tests for the velocity counter (PR 2c — closes OPL-CARD-001, OPL-CARD-015).
 *
 * Spec (velocity-counter/spec.md):
 *   - Single `UpdateCommand` with `UpdateExpression: ADD count :one`
 *   - Returns new count value
 *   - TTL: window + 1 hour
 *   - Conditional: skip if window expired (use TTL)
 *
 * InMemoryCounter is the test seam; the production DynamoCounter uses
 * UpdateCommand with TTL. Same interface, same semantics.
 */
describe("velocity counter — increment semantics", () => {
  let counter: VelocityCounter;

  beforeEach(() => {
    counter = new InMemoryCounter();
  });

  it("counter starts at 1 on first call", async () => {
    const { count } = await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 300,
      ttlSec: 300 + 3600,
    });
    expect(count).toBe(1);
  });

  it("counter returns new incremented count on subsequent calls", async () => {
    await counter.increment({ type: "IP_CARD", value: "192.0.2.1", windowSec: 300, ttlSec: 3960 });
    const { count } = await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 300,
      ttlSec: 3960,
    });
    expect(count).toBe(2);
  });

  it("different values tracked independently", async () => {
    await counter.increment({ type: "IP_CARD", value: "192.0.2.1", windowSec: 300, ttlSec: 3960 });
    const { count } = await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.2",
      windowSec: 300,
      ttlSec: 3960,
    });
    expect(count).toBe(1); // different IP → first call
  });

  it("different windows tracked independently for same value", async () => {
    await counter.increment({ type: "IP_CARD", value: "192.0.2.1", windowSec: 300, ttlSec: 3960 });
    const { count } = await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 600,
      ttlSec: 4260,
    });
    expect(count).toBe(1); // different window → first call
  });

  it("different counter types tracked independently for same value", async () => {
    await counter.increment({ type: "IP_CARD", value: "192.0.2.1", windowSec: 300, ttlSec: 3960 });
    const { count } = await counter.increment({
      type: "BIN_CARD",
      value: "192.0.2.1",
      windowSec: 60,
      ttlSec: 3660,
    });
    expect(count).toBe(1); // different type → first call
  });
});

describe("velocity counter — TTL expiry", () => {
  it("counter resets after window expires", async () => {
    const fakeNow = { current: 1_000_000 };
    const counter = new InMemoryCounter(() => fakeNow.current * 1000);

    await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 300,
      ttlSec: 3960,
      nowSec: () => fakeNow.current,
    });
    // Advance past TTL
    fakeNow.current = 1_000_000 + 3961;
    const { count } = await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 300,
      ttlSec: 3960,
      nowSec: () => fakeNow.current,
    });
    expect(count).toBe(1); // expired → reset to 1
  });

  it("counter persists within TTL window", async () => {
    const fakeNow = { current: 1_000_000 };
    const counter = new InMemoryCounter(() => fakeNow.current * 1000);

    await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 300,
      ttlSec: 3960,
      nowSec: () => fakeNow.current,
    });
    // Advance within TTL (just before expiry)
    fakeNow.current = 1_000_000 + 3959; // 1 second before TTL expiry
    const { count } = await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 300,
      ttlSec: 3960,
      nowSec: () => fakeNow.current,
    });
    expect(count).toBe(2); // within window → incremented
  });
});

describe("velocity counter — concurrent safety (in-memory semantics)", () => {
  it("concurrent increments produce consistent count", async () => {
    const counter = new InMemoryCounter();
    const promises = Array.from({ length: 10 }, () =>
      counter.increment({ type: "IP_CARD", value: "192.0.2.1", windowSec: 300, ttlSec: 3960 }),
    );
    const results = await Promise.all(promises);
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("velocity counter — input validation", () => {
  it("rejects empty value", async () => {
    const counter = new InMemoryCounter();
    await expect(
      counter.increment({ type: "IP_CARD", value: "", windowSec: 300, ttlSec: 3960 }),
    ).rejects.toThrow();
  });

  it("rejects zero windowSec", async () => {
    const counter = new InMemoryCounter();
    await expect(
      counter.increment({ type: "IP_CARD", value: "192.0.2.1", windowSec: 0, ttlSec: 0 }),
    ).rejects.toThrow();
  });

  it("rejects ttlSec < windowSec", async () => {
    const counter = new InMemoryCounter();
    await expect(
      counter.increment({ type: "IP_CARD", value: "192.0.2.1", windowSec: 300, ttlSec: 100 }),
    ).rejects.toThrow();
  });
});
