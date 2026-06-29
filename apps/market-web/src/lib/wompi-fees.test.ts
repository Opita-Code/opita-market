/**
 * OPL-COMP-020 (HIGH): Wompi fee disclosure.
 *
 * Verifies that:
 *   - Each channel returns the documented fee
 *   - Variable + fixed components add correctly
 *   - Bre-B returns 0 (no fee)
 *   - Display string format matches the SIC-required text
 *   - feeKeyForChannel handles all WOMPI_* prefixes
 */
import { describe, it, expect } from "vitest";
import {
  computeWompiFee,
  formatFeeDisclosure,
  feeKeyForChannel,
  totalWithFee,
  WOMPI_FEES,
} from "../lib/wompi-fees.js";

describe("OPL-COMP-020: Wompi fee disclosure", () => {
  describe("WOMPI_FEES table", () => {
    it("CARD: 2.99% + COP 900", () => {
      expect(WOMPI_FEES.CARD.variableRate).toBe(0.0299);
      expect(WOMPI_FEES.CARD.fixedCop).toBe(900);
    });
    it("PSE: COP 2,500 fixed (no variable)", () => {
      expect(WOMPI_FEES.PSE.variableRate).toBe(0);
      expect(WOMPI_FEES.PSE.fixedCop).toBe(2500);
    });
    it("NEQUI: COP 1,500 fixed", () => {
      expect(WOMPI_FEES.NEQUI.variableRate).toBe(0);
      expect(WOMPI_FEES.NEQUI.fixedCop).toBe(1500);
    });
    it("DAVIPLATA: COP 1,500 fixed", () => {
      expect(WOMPI_FEES.DAVIPLATA.variableRate).toBe(0);
      expect(WOMPI_FEES.DAVIPLATA.fixedCop).toBe(1500);
    });
    it("BREB: zero fee (free for user)", () => {
      expect(WOMPI_FEES.BREB.variableRate).toBe(0);
      expect(WOMPI_FEES.BREB.fixedCop).toBe(0);
    });
  });

  describe("feeKeyForChannel", () => {
    it("strips WOMPI_ prefix and uppercases", () => {
      expect(feeKeyForChannel("WOMPI_CARD")).toBe("CARD");
      expect(feeKeyForChannel("WOMPI_PSE")).toBe("PSE");
      expect(feeKeyForChannel("WOMPI_NEQUI")).toBe("NEQUI");
      expect(feeKeyForChannel("WOMPI_DAVIPLATA")).toBe("DAVIPLATA");
      expect(feeKeyForChannel("WOMPI_BREB")).toBe("BREB");
    });
    it("defaults unknown channels to CARD (worst case)", () => {
      expect(feeKeyForChannel("WOMPI_FUTURE_METHOD")).toBe("CARD");
      expect(feeKeyForChannel("")).toBe("CARD");
    });
  });

  describe("computeWompiFee", () => {
    it("CARD: variable + fixed for 100k COP", () => {
      // 100_000 * 0.0299 = 2_990 + 900 = 3_890
      expect(computeWompiFee(100_000, "WOMPI_CARD")).toBe(3_890);
    });
    it("CARD: variable + fixed for 1M COP", () => {
      // 1_000_000 * 0.0299 = 29_900 + 900 = 30_800
      expect(computeWompiFee(1_000_000, "WOMPI_CARD")).toBe(30_800);
    });
    it("PSE: fixed only, no variable", () => {
      expect(computeWompiFee(100_000, "WOMPI_PSE")).toBe(2_500);
      expect(computeWompiFee(1_000_000, "WOMPI_PSE")).toBe(2_500);
    });
    it("NEQUI: fixed only", () => {
      expect(computeWompiFee(50_000, "WOMPI_NEQUI")).toBe(1_500);
    });
    it("BREB: zero fee (compliance: no hidden fee to disclose)", () => {
      expect(computeWompiFee(1_000_000, "WOMPI_BREB")).toBe(0);
    });
    it("returns 0 for non-positive amounts", () => {
      expect(computeWompiFee(0, "WOMPI_CARD")).toBe(0);
      expect(computeWompiFee(-100, "WOMPI_CARD")).toBe(0);
      expect(computeWompiFee(NaN, "WOMPI_CARD")).toBe(0);
    });
    it("rounds to integer COP (no fractional amounts)", () => {
      const fee = computeWompiFee(33_333, "WOMPI_CARD");
      expect(Number.isInteger(fee)).toBe(true);
    });
  });

  describe("formatFeeDisclosure", () => {
    it("includes the fee in es-CO currency format", () => {
      const text = formatFeeDisclosure(100_000, "WOMPI_CARD");
      expect(text).toMatch(/^Incluye .* de comisión por procesamiento de pago\.$/);
      expect(text).toContain("3.890"); // Intl.NumberFormat es-CO uses . as thousands
    });
    it("returns empty string for BREB (no fee → nothing to disclose)", () => {
      expect(formatFeeDisclosure(1_000_000, "WOMPI_BREB")).toBe("");
    });
    it("handles PSE fixed-fee text", () => {
      const text = formatFeeDisclosure(100_000, "WOMPI_PSE");
      expect(text).toContain("2.500");
    });
  });

  describe("totalWithFee (forward-compat helper)", () => {
    it("CARD 100k = 100k + 3,890 = 103,890", () => {
      expect(totalWithFee(100_000, "WOMPI_CARD")).toBe(103_890);
    });
    it("BREB 1M = 1M (no fee added)", () => {
      expect(totalWithFee(1_000_000, "WOMPI_BREB")).toBe(1_000_000);
    });
  });
});
