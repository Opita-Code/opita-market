import { describe, it, expect } from "vitest";
import {
  TIERS,
  canPromoteTo,
  withdrawHoldFor,
  requires3DS,
  isValidTier,
  type Tier,
} from "../../src/lib/tiers.js";

describe("tiers — Tier 0-4 system", () => {
  describe("TIERS config", () => {
    it("defines all 5 tiers (0, 1, 2, 3, 4)", () => {
      expect(Object.keys(TIERS).sort()).toEqual(["0", "1", "2", "3", "4"]);
    });

    it("Tier 0: smallest limits, longest hold, always requires 3DS", () => {
      const t = TIERS[0];
      expect(t.tier).toBe(0);
      expect(t.receiveLimitDayCop).toBe(500_000);
      expect(t.withdrawHoldHours).toBe(72);
      expect(t.threeDsThresholdCop).toBe(0);
      expect(t.badge).toBeNull();
    });

    it("Tier 2: rural-aware — $20M COP/day receive (covers cattle/harvest)", () => {
      const t = TIERS[2];
      expect(t.receiveLimitDayCop).toBe(20_000_000);
      expect(t.receiveLimitWeekCop).toBe(50_000_000);
      expect(t.badge).toBe("Vendedor verificado");
    });

    it("Tier 4: enterprise — no weekly cap, no daily cap, never requires 3DS", () => {
      const t = TIERS[4];
      expect(t.receiveLimitDayCop).toBe(500_000_000);
      expect(t.receiveLimitWeekCop).toBe(Number.MAX_SAFE_INTEGER);
      expect(t.withdrawLimitDayCop).toBe(Number.MAX_SAFE_INTEGER);
      expect(t.threeDsThresholdCop).toBe(Number.MAX_SAFE_INTEGER);
      expect(t.badge).toBe("Empresa verificada");
    });

    it("limits always increase monotonically with tier", () => {
      const tiers: Tier[] = [0, 1, 2, 3, 4];
      for (let i = 1; i < tiers.length; i++) {
        const prev = TIERS[tiers[i - 1]];
        const curr = TIERS[tiers[i]];
        expect(curr.receiveLimitDayCop).toBeGreaterThan(prev.receiveLimitDayCop);
        expect(curr.withdrawLimitDayCop).toBeGreaterThanOrEqual(prev.withdrawLimitDayCop);
        expect(curr.withdrawHoldHours).toBeLessThanOrEqual(prev.withdrawHoldHours);
      }
    });
  });

  describe("canPromoteTo", () => {
    it("returns false when target <= current tier", () => {
      const verified = new Set(["email", "city"]);
      expect(canPromoteTo(2, 1, verified)).toBe(false);
      expect(canPromoteTo(2, 2, verified)).toBe(false);
    });

    it("returns true when all target tier requirements are met", () => {
      // Tier 1 requires: celular, email, nombre, ciudad
      const allTier1 = new Set(TIERS[1].requirements);
      expect(canPromoteTo(0, 1, allTier1)).toBe(true);
    });

    it("returns false when any target tier requirement is missing", () => {
      // Missing "email"
      const missingEmail = new Set(["celular", "nombre", "ciudad"]);
      expect(canPromoteTo(0, 1, missingEmail)).toBe(false);
    });

    it("returns false when promoting to tier 2 without NIT validation", () => {
      const withoutNit = new Set(TIERS[1].requirements); // tier 1 complete
      expect(canPromoteTo(1, 2, withoutNit)).toBe(false);
    });
  });

  describe("withdrawHoldFor", () => {
    it("Tier 0: 72h always", () => {
      expect(withdrawHoldFor(0, 100)).toBe(72);
      expect(withdrawHoldFor(0, 500_000)).toBe(72);
    });

    it("Tier 1: 24h", () => {
      expect(withdrawHoldFor(1, 100)).toBe(24);
    });

    it("Tier 2: 4h", () => {
      expect(withdrawHoldFor(2, 100)).toBe(4);
      expect(withdrawHoldFor(2, 5_000_000)).toBe(4);
    });

    it("Tier 3: T+0 up to $5M, T+4h above $5M", () => {
      expect(withdrawHoldFor(3, 1_000_000)).toBe(0);
      expect(withdrawHoldFor(3, 5_000_000)).toBe(0);   // boundary
      expect(withdrawHoldFor(3, 5_000_001)).toBe(4);   // just above
      expect(withdrawHoldFor(3, 50_000_000)).toBe(4);
    });

    it("Tier 4: T+0 always", () => {
      expect(withdrawHoldFor(4, 1)).toBe(0);
      expect(withdrawHoldFor(4, 500_000_000)).toBe(0);
    });
  });

  describe("requires3DS", () => {
    it("Tier 0 always requires 3DS", () => {
      expect(requires3DS(0, 1)).toBe(true);
      expect(requires3DS(0, 0)).toBe(true); // threshold is 0
    });

    it("Tier 1 requires 3DS above $200k", () => {
      expect(requires3DS(1, 199_999)).toBe(false);
      expect(requires3DS(1, 200_000)).toBe(false);
      expect(requires3DS(1, 200_001)).toBe(true);
      expect(requires3DS(1, 1_000_000)).toBe(true);
    });

    it("Tier 2 requires 3DS above $5M", () => {
      expect(requires3DS(2, 5_000_000)).toBe(false);
      expect(requires3DS(2, 5_000_001)).toBe(true);
    });

    it("Tier 3+ never requires 3DS", () => {
      expect(requires3DS(3, 999_999_999)).toBe(false);
      expect(requires3DS(4, 999_999_999)).toBe(false);
    });
  });

  describe("isValidTier", () => {
    it("accepts all 5 tiers", () => {
      expect(isValidTier(0)).toBe(true);
      expect(isValidTier(1)).toBe(true);
      expect(isValidTier(2)).toBe(true);
      expect(isValidTier(3)).toBe(true);
      expect(isValidTier(4)).toBe(true);
    });

    it("rejects invalid tiers", () => {
      expect(isValidTier(5)).toBe(false);
      expect(isValidTier(-1)).toBe(false);
      expect(isValidTier(2.5)).toBe(false);
      expect(isValidTier("2")).toBe(false);
      expect(isValidTier(null)).toBe(false);
    });
  });
});