import { describe, it, expect } from "vitest";
import { add, subtract, isPositive, isZero, maxCop, sumAll, formatCop, COP_MAX_SAFE } from "../../src/lib/money.js";

describe("money — integer-only COP math", () => {
  describe("add", () => {
    it("adds two positive integers", () => {
      expect(add(1000, 500)).toBe(1500);
    });

    it("returns the same value when adding 0", () => {
      expect(add(1000, 0)).toBe(1000);
      expect(add(0, 1000)).toBe(1000);
    });

    it("throws on negative operands (input validation)", () => {
      expect(() => add(-1, 100)).toThrow();
      expect(() => add(100, -1)).toThrow();
    });

    it("throws on non-integer operands (no float)", () => {
      expect(() => add(1.5, 100)).toThrow();
      expect(() => add(100, 1.5)).toThrow();
    });

    it("throws on overflow (sum exceeds COP_MAX_SAFE)", () => {
      expect(() => add(COP_MAX_SAFE, 1)).toThrow();
    });

    it("accepts exactly COP_MAX_SAFE", () => {
      expect(add(COP_MAX_SAFE, 0)).toBe(COP_MAX_SAFE);
    });
  });

  describe("subtract", () => {
    it("subtracts two positive integers", () => {
      expect(subtract(1000, 300)).toBe(700);
    });

    it("returns 0 when subtracting equal amounts", () => {
      expect(subtract(1000, 1000)).toBe(0);
    });

    it("throws on negative result (would be overdraft)", () => {
      expect(() => subtract(500, 1000)).toThrow();
    });

    it("throws on negative operands", () => {
      expect(() => subtract(-1, 100)).toThrow();
      expect(() => subtract(100, -1)).toThrow();
    });

    it("throws on non-integer operands", () => {
      expect(() => subtract(1.5, 100)).toThrow();
    });
  });

  describe("isPositive", () => {
    it("returns true for >0", () => {
      expect(isPositive(1)).toBe(true);
      expect(isPositive(1000)).toBe(true);
    });

    it("returns false for 0", () => {
      expect(isPositive(0)).toBe(false);
    });

    it("returns false for negatives", () => {
      expect(isPositive(-1)).toBe(false);
      expect(isPositive(-1000)).toBe(false);
    });
  });

  describe("isZero", () => {
    it("returns true for 0", () => {
      expect(isZero(0)).toBe(true);
    });

    it("returns false for non-zero", () => {
      expect(isZero(1)).toBe(false);
      expect(isZero(-1)).toBe(false);
      expect(isZero(0.0001)).toBe(false);
    });
  });

  describe("maxCop", () => {
    it("returns the larger of two integers", () => {
      expect(maxCop(100, 200)).toBe(200);
      expect(maxCop(200, 100)).toBe(200);
    });

    it("returns either when equal", () => {
      expect(maxCop(100, 100)).toBe(100);
    });

    it("handles 0", () => {
      expect(maxCop(0, 100)).toBe(100);
      expect(maxCop(100, 0)).toBe(100);
      expect(maxCop(0, 0)).toBe(0);
    });
  });

  describe("sumAll", () => {
    it("sums an array of integers", () => {
      expect(sumAll([100, 200, 300])).toBe(600);
    });

    it("returns 0 for empty array", () => {
      expect(sumAll([])).toBe(0);
    });

    it("throws on negative elements", () => {
      expect(() => sumAll([100, -1])).toThrow();
    });

    it("throws on non-integer elements", () => {
      expect(() => sumAll([100, 1.5])).toThrow();
    });

    it("throws on overflow", () => {
      expect(() => sumAll([COP_MAX_SAFE, 1])).toThrow();
    });
  });

  describe("formatCop", () => {
    it("formats positive integers with COP prefix and thousands separator", () => {
      expect(formatCop(1000)).toBe("COP $1.000");
      expect(formatCop(1_000_000)).toBe("COP $1.000.000");
      expect(formatCop(20_000_000)).toBe("COP $20.000.000");
    });

    it("formats 0", () => {
      expect(formatCop(0)).toBe("COP $0");
    });

    it("throws on negative (no formatting of debt in user-facing output)", () => {
      expect(() => formatCop(-100)).toThrow();
    });

    it("throws on non-integer", () => {
      expect(() => formatCop(1.5)).toThrow();
    });
  });

  describe("COP_MAX_SAFE invariant", () => {
    it("is exactly Number.MAX_SAFE_INTEGER (9_007_199_254_740_991)", () => {
      expect(COP_MAX_SAFE).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("is well above the maximum tier 4 receive limit (500M COP)", () => {
      const tier4Daily = 500_000_000;
      const tier4Yearly = tier4Daily * 365;
      expect(tier4Yearly).toBeLessThan(COP_MAX_SAFE);
    });
  });
});