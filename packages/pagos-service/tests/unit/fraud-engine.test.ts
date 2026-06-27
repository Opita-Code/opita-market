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
  describe("single-signal decisions", () => {
    it("BLOCK when TOR_EXIT (weight=1.0) fires alone", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("TOR_EXIT", 1.0)]);
      expect(result.decision).toBe("BLOCK");
      expect(result.score).toBe(1.0);
    });

    it("BLOCK when BLACKLIST_MATCH (weight=0.9) fires alone", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("BLACKLIST_MATCH", 0.9)]);
      expect(result.decision).toBe("BLOCK");
    });

    it("BLOCK when CHARGEBACK_HISTORY (weight=0.8) fires alone", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("CHARGEBACK_HISTORY", 0.8)]);
      expect(result.decision).toBe("BLOCK");
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
      expect(result.score).toBe(0);
    });

    it("ALLOW when low-weight signal fires alone (weight=0.2)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([signal("GEO_CITY_MISMATCH", 0.2)]);
      expect(result.decision).toBe("ALLOW");
    });
  });

  describe("multi-signal aggregation", () => {
    it("BLOCK when 3 medium signals sum to >=0.7", () => {
      const engine = new FraudEngine();
      // 0.3 + 0.3 + 0.2 = 0.8 → BLOCK
      const result = engine.evaluateSignals([
        signal("GEO_MISMATCH", 0.3),
        signal("PROXY_DETECTED", 0.3),
        signal("SUSPICIOUS_TIMING", 0.2),
      ]);
      expect(result.decision).toBe("BLOCK");
      expect(result.score).toBeCloseTo(0.8, 2);
    });

    it("REVIEW when 2 signals sum to >=0.4 and <0.7", () => {
      const engine = new FraudEngine();
      // 0.3 + 0.2 = 0.5 → REVIEW
      const result = engine.evaluateSignals([
        signal("GEO_MISMATCH", 0.3),
        signal("GEO_CITY_MISMATCH", 0.2),
      ]);
      expect(result.decision).toBe("REVIEW");
      expect(result.score).toBeCloseTo(0.5, 2);
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
  });

  describe("boundary cases", () => {
    it("score exactly 0.7 → BLOCK (inclusive)", () => {
      const engine = new FraudEngine();
      // 0.4 + 0.3 = 0.7 → BLOCK
      const result = engine.evaluateSignals([
        signal("VELOCITY_EXCEEDED", 0.4),
        signal("GEO_MISMATCH", 0.3),
      ]);
      expect(result.decision).toBe("BLOCK");
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
      expect(result.score).toBeGreaterThanOrEqual(0);
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

    it("scenario: Tor user (BLOCK)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("TOR_EXIT", 1.0),
        signal("VPN_DETECTED", 0.8),
      ]);
      expect(result.decision).toBe("BLOCK");
    });

    it("scenario: card tester (velocity + datacenter + blacklist)", () => {
      const engine = new FraudEngine();
      const result = engine.evaluateSignals([
        signal("VELOCITY_EXCEEDED", 0.6),
        signal("DATACENTER_IP", 0.5),
        signal("BLACKLIST_MATCH", 0.9),
      ]);
      // 0.6 + 0.5 + 0.9 = 2.0 → BLOCK
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
  });
});

function signal(type: FraudSignalType, weight: number): FraudSignal {
  return { type, weight };
}