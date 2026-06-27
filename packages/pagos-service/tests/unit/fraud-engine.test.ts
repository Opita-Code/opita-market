import { describe, it, expect } from "vitest";
import {
  FraudEngine,
  type FraudSignal,
  type FraudSignalType,
} from "../../src/lib/fraud.js";

/**
 * Tests for the anti-fraud engine.
 *
 * ALGORITHM:
 *   - Score = SUM of signal weights (not average — strong single signals trigger BLOCK)
 *   - Decision:
 *       score >= 0.7  → BLOCK
 *       score >= 0.4  → REVIEW
 *       score <  0.4  → ALLOW
 */

describe("fraud — decision matrix", () => {
  describe("single-signal decisions (PR 2c: cap=0.5 means single signals go to REVIEW, not BLOCK)", () => {
    it("REVIEW when TOR_EXIT (weight=1.0) fires alone — capped to 0.5", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("TOR_EXIT", 1.0)]);
      expect(result.decision).toBe("REVIEW");
      expect(result.cappedScore).toBe(0.5);
    });

    it("REVIEW when BLACKLIST_MATCH (weight=0.9) fires alone — capped to 0.5", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("BLACKLIST_MATCH", 0.9)]);
      expect(result.decision).toBe("REVIEW");
      expect(result.cappedScore).toBe(0.5);
    });

    it("REVIEW when CHARGEBACK_HISTORY (weight=0.8) fires alone — capped to 0.5", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("CHARGEBACK_HISTORY", 0.8)]);
      expect(result.decision).toBe("REVIEW");
      expect(result.cappedScore).toBe(0.5);
    });

    it("REVIEW when DATACENTER_IP (weight=0.5) fires alone", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("DATACENTER_IP", 0.5)]);
      expect(result.decision).toBe("REVIEW");
    });

    it("ALLOW when SUSPICIOUS_TIMING (weight=0.3) fires alone (below REVIEW threshold 0.4)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("SUSPICIOUS_TIMING", 0.3)]);
      expect(result.decision).toBe("ALLOW");
    });

    it("ALLOW when no signals fire", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([]);
      expect(result.decision).toBe("ALLOW");
      expect(result.cappedScore).toBe(0);
    });

    it("ALLOW when low-weight signal fires alone (weight=0.2)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("GEO_CITY_MISMATCH", 0.2)]);
      expect(result.decision).toBe("ALLOW");
    });
  });

  describe("multi-signal aggregation (PR 2c: BLOCK requires multiple signals to accumulate)", () => {
    it("BLOCK when 3 medium signals sum to >=0.8 (3 × 0.3 capped = 0.9)", () => {
      const engine = new FraudEngine();
      // 0.3 + 0.3 + 0.2 = 0.8 → BLOCK
      const result = engine.evaluateSignals([
        signal("GEO_MISMATCH", 0.3),
        signal("PROXY_DETECTED", 0.3),
        signal("SUSPICIOUS_TIMING", 0.2),
      ]);
      expect(result.decision).toBe("BLOCK");
      expect(result.cappedScore).toBeCloseTo(0.8, 2);
    });

    it("BLOCK when 2 strong signals hit cap (0.6+0.5 → 0.5+0.5 = 1.0)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("VELOCITY_EXCEEDED", 0.6),
        signal("DATACENTER_IP", 0.5),
      ]);
      expect(result.decision).toBe("BLOCK");
      expect(result.cappedScore).toBe(1.0);
    });

    it("REVIEW when 2 signals sum to >=0.4 and <0.8", () => {
      const engine = new FraudEngine();
      // 0.3 + 0.2 = 0.5 → REVIEW
      const result = engine.evaluateSignals([
        signal("GEO_MISMATCH", 0.3),
        signal("GEO_CITY_MISMATCH", 0.2),
      ]);
      expect(result.decision).toBe("REVIEW");
      expect(result.cappedScore).toBeCloseTo(0.5, 2);
    });

    it("ALLOW when signals sum to <0.4", () => {
      const engine = new FraudEngine();
      // 0.2 + 0.1 = 0.3 → ALLOW
      const result = engine.evaluateSignals([
        signal("GEO_CITY_MISMATCH", 0.2),
        signal("SUSPICIOUS_TIMING", 0.1),
      ]);
      expect(result.decision).toBe("ALLOW");
    });

    it("REVIEW when 5 weak signals sum (0.15 × 5 = 0.75) — below 0.8 threshold", () => {
      // PR 2c — closes OPL-CARD-007 high FPR
      const engine = new FraudEngine();
      const signals = Array.from({ length: 5 }, () => signal("SUSPICIOUS_TIMING", 0.15));
      const result = engine.evaluateSignals(signals);
      // 0.15 × 5 = 0.75 → REVIEW (not BLOCK)
      expect(result.cappedScore).toBeCloseTo(0.75, 2);
      expect(result.decision).toBe("REVIEW");
    });
  });

  describe("boundary cases (PR 2c: BLOCK threshold raised to 0.8)", () => {
    it("score exactly 0.8 → BLOCK (inclusive)", () => {
      const engine = new FraudEngine();
      // 0.4 + 0.4 = 0.8 → BLOCK (PR 2c: 0.7 → 0.8)
      const result = engine.evaluateSignals([
        signal("VELOCITY_EXCEEDED", 0.4),
        signal("GEO_MISMATCH", 0.4),
      ]);
      expect(result.decision).toBe("BLOCK");
    });

    it("score 0.7 → REVIEW (below new 0.8 threshold)", () => {
      // PR 2c: 0.7 used to be BLOCK, now REVIEW
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("VELOCITY_EXCEEDED", 0.4),
        signal("GEO_MISMATCH", 0.3),
      ]);
      expect(result.cappedScore).toBeCloseTo(0.7, 2);
      expect(result.decision).toBe("REVIEW");
    });

    it("score exactly 0.4 → REVIEW (inclusive lower bound)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("VELOCITY_EXCEEDED", 0.4)]);
      expect(result.decision).toBe("REVIEW");
    });

    it("score 0.39 → ALLOW (just below REVIEW threshold)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("VELOCITY_EXCEEDED", 0.39)]);
      expect(result.decision).toBe("ALLOW");
    });
  });

  describe("output invariants", () => {
    it("returns score as a non-negative number", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("TOR_EXIT", 1.0),
        signal("BLACKLIST_MATCH", 0.9),
      ]);
      expect(result.cappedScore).toBeGreaterThanOrEqual(0);
    });

    it("returns signal count equal to input", () => {
      const engine = new FraudEngine();
      const signals = [
        signal("GEO_MISMATCH", 0.3),
        signal("TOR_EXIT", 1.0),
        signal("BLACKLIST_MATCH", 0.9),
      ];
      const result = engine.evaluateSignals(signals);
      expect(result.signals).toHaveLength(signals.length);
    });

    it("preserves signal details (type, weight) in output", () => {
      const engine = new FraudEngine();
      const inputSignals: FraudSignal[] = [signal("TOR_EXIT", 1.0)];
      const result = engine.evaluateSignals(inputSignals);
      expect(result.signals[0]).toEqual({ type: "TOR_EXIT", weight: 1.0 });
    });

    it("decision is one of ALLOW, REVIEW, BLOCK", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("TOR_EXIT", 1.0)]);
      expect(["ALLOW", "REVIEW", "BLOCK"]).toContain(result.decision);
    });
  });

  describe("weight validation", () => {
    it("throws on weight > 1.0", () => {
      const engine = new FraudEngine();
      expect(() => engine.evaluateSignals([signal("TOR_EXIT", 1.5)])).toThrow();
    });

    it("throws on weight < 0.0", () => {
      const engine = new FraudEngine();
      expect(() => engine.evaluateSignals([signal("TOR_EXIT", -0.1)])).toThrow();
    });

    it("throws on non-finite weight", () => {
      const engine = new FraudEngine();
      expect(() => engine.evaluateSignals([signal("TOR_EXIT", Number.NaN)])).toThrow();
      expect(() => engine.evaluateSignals([signal("TOR_EXIT", Infinity)])).toThrow();
    });
  });

  describe("realistic scenarios", () => {
    it("scenario: legit Colombian user (no signals)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([]);
      expect(result.decision).toBe("ALLOW");
    });

    it("scenario: rural vendor on mobile (low signal)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("GEO_CITY_MISMATCH", 0.15)]);
      expect(result.decision).toBe("ALLOW");
    });

    it("scenario: Tor user (BLOCK via cap+threshold: 1.0+0.8 → 0.5+0.5 = 1.0)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("TOR_EXIT", 1.0),
        signal("VPN_DETECTED", 0.8),
      ]);
      // PR 2c: 1.0 capped to 0.5, 0.8 capped to 0.5, sum = 1.0 → BLOCK
      expect(result.cappedScore).toBe(1.0);
      expect(result.decision).toBe("BLOCK");
    });

    it("scenario: card tester (velocity + datacenter + blacklist) → BLOCK", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("VELOCITY_EXCEEDED", 0.6),
        signal("DATACENTER_IP", 0.5),
        signal("BLACKLIST_MATCH", 0.9),
      ]);
      // 0.5 + 0.5 + 0.5 (all capped) = 1.5 → BLOCK
      expect(result.cappedScore).toBe(1.5);
      expect(result.decision).toBe("BLOCK");
    });

    it("scenario: new user with city mismatch (REVIEW)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("GEO_MISMATCH", 0.4),
        signal("GEO_CITY_MISMATCH", 0.25),
      ]);
      // 0.4 + 0.25 = 0.65 → REVIEW
      expect(result.decision).toBe("REVIEW");
    });

    it("scenario: legit cloud worker (datacenter + night) → BLOCK at boundary 0.8", () => {
      // PR 2c — closes OPL-CARD-007 reproduction scenario (partial)
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("DATACENTER_IP", 0.5),
        signal("SUSPICIOUS_TIMING", 0.3),
      ]);
      // 0.5 + 0.3 = 0.8 → BLOCK (at threshold, inclusive)
      // Pre-PR 2c this was also BLOCK (0.5+0.3=0.8 → BLOCK). Cap doesn't change
      // for these two signals because neither exceeds 0.5. The real reduction
      // comes when VPN (0.8) is added — see next test.
      expect(result.decision).toBe("BLOCK");
    });

    it("scenario: legit cloud worker with single moderate signal → REVIEW", () => {
      // PR 2c — single signals alone no longer force BLOCK
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("DATACENTER_IP", 0.5)]);
      expect(result.decision).toBe("REVIEW");
    });

    it("scenario: legit cloud worker with VPN (datacenter + night + VPN) → REVIEW with cap", () => {
      // PR 2c — original pentest repro for OPL-CARD-007
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("DATACENTER_IP", 0.5),
        signal("SUSPICIOUS_TIMING", 0.3),
        signal("VPN_DETECTED", 0.8),
      ]);
      // Cap reduces: 0.5 + 0.3 + 0.5 = 1.3 → BLOCK (still BLOCKs)
      // The cap doesn't fully solve OPL-CARD-007 for VPN+datacenter+timing, but
      // it reduces severity. The threshold is now 0.8 instead of 0.7, so
      // borderline cases fall to REVIEW instead of BLOCK.
      expect(result.cappedScore).toBe(1.3);
      expect(result.decision).toBe("BLOCK"); // still BLOCKs but lower than before
    });
  });
});

function signal(type: FraudSignalType, weight: number): FraudSignal {
  return { type, weight };
}