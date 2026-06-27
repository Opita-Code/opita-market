import { describe, it, expect, beforeEach } from "vitest";
import {
  collectVelocitySignals,
  type VelocitySignalsDeps,
} from "../../../src/lib/velocity/signals.js";
import { InMemoryCounter } from "../../../src/lib/velocity/counter.js";
import { InMemoryUserHistory } from "../../../src/lib/velocity/user-history.js";
import type { VelocityCounter } from "../../../src/lib/velocity/types.js";
import type { UserHistory } from "../../../src/lib/velocity/user-history.js";

/**
 * Tests for velocity signal emission (PR 2c — closes OPL-CARD-001, OPL-CARD-015).
 *
 * Spec (velocity-counter/spec.md):
 *   - BIN_CARD: per first-6-digits of PAN, window 1 minute, threshold 10
 *   - IP_CARD: per source IP, window 5 minutes, threshold 50
 *   - DEVICE_CARD: per device fingerprint, window 5 minutes, threshold 20
 *   - EMAIL_INTENT: per user email, window 1 hour, threshold 100
 *   - Signal weight: 0.6 (per carding-domain taxonomy)
 */
describe("velocity signals — threshold detection", () => {
  let counter: VelocityCounter;
  let history: UserHistory;
  let deps: VelocitySignalsDeps;

  beforeEach(() => {
    counter = new InMemoryCounter();
    history = new InMemoryUserHistory();
    deps = { counter, history };
  });

  describe("per-BIN limit (10/min)", () => {
    it("no signal below threshold (≤10 calls)", async () => {
      for (let i = 0; i < 10; i++) {
        const result = await collectVelocitySignals(deps, { bin: "453212" });
        expect(result.signals).toEqual([]);
      }
    });

    it("emits VELOCITY_EXCEEDED on 11th call (above threshold)", async () => {
      for (let i = 0; i < 10; i++) {
        await collectVelocitySignals(deps, { bin: "453212" });
      }
      const result = await collectVelocitySignals(deps, { bin: "453212" });
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0]).toEqual({ type: "VELOCITY_EXCEEDED", weight: 0.6 });
    });
  });

  describe("per-IP limit (50/5min)", () => {
    it("emits VELOCITY_EXCEEDED on 51st call", async () => {
      for (let i = 0; i < 50; i++) {
        await collectVelocitySignals(deps, { ip: "192.0.2.1" });
      }
      const result = await collectVelocitySignals(deps, { ip: "192.0.2.1" });
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe("VELOCITY_EXCEEDED");
    });
  });

  describe("per-device limit (20/5min)", () => {
    it("emits VELOCITY_EXCEEDED on 21st call", async () => {
      for (let i = 0; i < 20; i++) {
        await collectVelocitySignals(deps, { deviceId: "device-abc" });
      }
      const result = await collectVelocitySignals(deps, { deviceId: "device-abc" });
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe("VELOCITY_EXCEEDED");
    });
  });

  describe("per-email limit (100/hour)", () => {
    it("emits VELOCITY_EXCEEDED on 101st call", async () => {
      for (let i = 0; i < 100; i++) {
        await collectVelocitySignals(deps, { email: "user@example.com" });
      }
      const result = await collectVelocitySignals(deps, { email: "user@example.com" });
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe("VELOCITY_EXCEEDED");
    });
  });
});

describe("velocity signals — legitimate power user (closes OPL-CARD-001 FPR)", () => {
  it("19 purchases from same device not blocked (under DEVICE_CARD threshold)", async () => {
    const counter = new InMemoryCounter();
    const history = new InMemoryUserHistory();
    const deps: VelocitySignalsDeps = { counter, history };

    // 19 purchases from same IP, same device, same email — under DEVICE_CARD threshold of 20
    for (let i = 0; i < 19; i++) {
      const result = await collectVelocitySignals(deps, {
        ip: "192.0.2.1",
        deviceId: "device-abc",
        email: "user@example.com",
      });
      expect(result.signals).toEqual([]); // No velocity signal
    }
  });

  it("49 purchases from same IP not blocked (under IP_CARD threshold)", async () => {
    const counter = new InMemoryCounter();
    const history = new InMemoryUserHistory();
    const deps: VelocitySignalsDeps = { counter, history };

    // 49 purchases from same IP — under IP_CARD threshold of 50
    for (let i = 0; i < 49; i++) {
      const result = await collectVelocitySignals(deps, {
        ip: "192.0.2.1",
      });
      expect(result.signals).toEqual([]);
    }
  });
});

describe("velocity signals — repeat offender (closes OPL-CARD-012)", () => {
  it("prior BLOCK in UserHistory → auto-BLOCK signal", async () => {
    const counter = new InMemoryCounter();
    const history = new InMemoryUserHistory();
    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "TOR_EXIT",
      timestampMs: Date.now(),
    });
    const deps: VelocitySignalsDeps = { counter, history };

    const result = await collectVelocitySignals(deps, {
      userId: "user-123",
      ip: "192.0.2.1",
    });

    expect(result.recentBlock).not.toBeNull();
    expect(result.signals.some((s) => s.weight === 1.0)).toBe(true); // auto-BLOCK signal
  });
});

describe("velocity signals — IP rotation attack (closes OPL-CARD-015)", () => {
  it("EMAIL_INTENT triggers BLOCK on 101st rotation", async () => {
    const counter = new InMemoryCounter();
    const history = new InMemoryUserHistory();
    const deps: VelocitySignalsDeps = { counter, history };

    // 100 different IPs, same email
    for (let i = 0; i < 100; i++) {
      await collectVelocitySignals(deps, {
        ip: `10.0.0.${i}`,
        email: "attacker@example.com",
      });
    }
    // 101st IP — email counter trips
    const result = await collectVelocitySignals(deps, {
      ip: "10.0.0.100",
      email: "attacker@example.com",
    });
    expect(result.signals.some((s) => s.type === "VELOCITY_EXCEEDED")).toBe(true);
  });
});
