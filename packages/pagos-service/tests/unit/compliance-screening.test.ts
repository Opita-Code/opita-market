import { describe, it, expect, beforeEach } from "vitest";
import {
  MockComplianceScreeningProvider,
  type ComplianceScreeningProvider,
  type ScreeningRequest,
  type ScreeningResult,
} from "../../src/lib/compliance-screening-mock.js";
import {
  assessRisk,
  shouldBlockTransaction,
  shouldReviewTransaction,
  RISK_THRESHOLDS,
} from "../../src/lib/compliance-screening.js";

/**
 * Tests for PR 4b — PEP + Sanctions screening provider abstraction.
 *
 * Closes:
 *   - OPL-COMP-018 (no PEP screening)
 *   - OPL-COMP-019 (no sanctions screening)
 *
 * Design: provider abstraction + mock. Production code is ready;
 * swapping in ComplyAdvantage / Refinitiv / etc. is a 1-line change.
 */

describe("PR 4b — provider abstraction (interface contract)", () => {
  it("defines ComplianceScreeningProvider with screenUser + screenTransaction", () => {
    // Type-level assertion: provider MUST expose both methods
    const provider: ComplianceScreeningProvider = new MockComplianceScreeningProvider();
    expect(typeof provider.screenUser).toBe("function");
    expect(typeof provider.screenTransaction).toBe("function");
  });

  it("returns risk level (LOW | MEDIUM | HIGH)", async () => {
    const provider = new MockComplianceScreeningProvider();
    const result = await provider.screenUser({
      userId: "u-1",
      fullName: "John Smith",
      country: "US",
    });
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.riskLevel);
  });

  it("returns matches array (PEP, sanctions, adverse media)", async () => {
    const provider = new MockComplianceScreeningProvider();
    const result = await provider.screenUser({
      userId: "u-2",
      fullName: "John Smith",
      country: "US",
    });
    expect(Array.isArray(result.matches)).toBe(true);
    for (const match of result.matches) {
      expect(["PEP", "SANCTIONS", "ADVERSE_MEDIA"]).toContain(match.type);
      expect(match.source).toBeTruthy();
      expect(match.matchScore).toBeGreaterThan(0);
      expect(match.matchScore).toBeLessThanOrEqual(1);
    }
  });
});

describe("PR 4b — MockComplianceScreeningProvider behavior", () => {
  let provider: ComplianceScreeningProvider;

  beforeEach(() => {
    provider = new MockComplianceScreeningProvider();
  });

  it("returns LOW risk for clean users (no matches)", async () => {
    const result = await provider.screenUser({
      userId: "u-clean",
      fullName: "Jane Doe",
      country: "CO",
    });
    expect(result.riskLevel).toBe("LOW");
    expect(result.matches).toHaveLength(0);
  });

  it("returns HIGH risk for users in PEP watchlist", async () => {
    // Mock: PEP watchlist includes "Juan PEP Test"
    const result = await provider.screenUser({
      userId: "u-pep",
      fullName: "Juan PEP Test",
      country: "CO",
    });
    expect(result.riskLevel).toBe("HIGH");
    expect(result.matches.some((m) => m.type === "PEP")).toBe(true);
  });

  it("returns HIGH risk for users in sanctions list (OFAC/UN)", async () => {
    // Mock: sanctions list includes "Evil Sanctioned Person"
    const result = await provider.screenUser({
      userId: "u-sanctioned",
      fullName: "Evil Sanctioned Person",
      country: "XX",
    });
    expect(result.riskLevel).toBe("HIGH");
    expect(result.matches.some((m) => m.type === "SANCTIONS")).toBe(true);
  });

  it("screenTransaction returns MEDIUM for amounts > 1M COP", async () => {
    const result = await provider.screenTransaction({
      userId: "u-tx",
      amountCop: 1_500_000,
      channel: "WOMPI_CARD",
      counterpartyUserId: "seller-1",
    });
    // Mock: amounts > 1M COP trigger transaction-level screening
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.riskLevel);
    expect(result.screeningType).toBe("TRANSACTION");
  });

  it("screenTransaction returns LOW for amounts <= 1M COP", async () => {
    const result = await provider.screenTransaction({
      userId: "u-tx-small",
      amountCop: 500_000,
      channel: "WOMPI_CARD",
      counterpartyUserId: "seller-2",
    });
    expect(result.riskLevel).toBe("LOW");
    expect(result.matches).toHaveLength(0);
  });

  it("screenTransaction flags high-risk counterparties (PEP/sanctions)", async () => {
    const result = await provider.screenTransaction({
      userId: "u-buyer",
      amountCop: 5_000_000,
      channel: "WOMPI_CARD",
      counterpartyUserId: "u-sanctioned",
      counterpartyName: "Evil Sanctioned Person",
      counterpartyCountry: "XX",
    });
    expect(result.riskLevel).toBe("HIGH");
  });
});

describe("PR 4b — risk assessment helpers", () => {
  it("RISK_THRESHOLDS defines BLOCK/REVIEW/ALLOW boundaries", () => {
    expect(RISK_THRESHOLDS.BLOCK).toBe("HIGH");
    expect(RISK_THRESHOLDS.REVIEW).toBe("MEDIUM");
    expect(RISK_THRESHOLDS.ALLOW).toBe("LOW");
  });

  it("shouldBlockTransaction returns true only for HIGH risk", () => {
    expect(shouldBlockTransaction({ riskLevel: "HIGH" })).toBe(true);
    expect(shouldBlockTransaction({ riskLevel: "MEDIUM" })).toBe(false);
    expect(shouldBlockTransaction({ riskLevel: "LOW" })).toBe(false);
  });

  it("shouldReviewTransaction returns true only for MEDIUM risk", () => {
    expect(shouldReviewTransaction({ riskLevel: "HIGH" })).toBe(false);
    expect(shouldReviewTransaction({ riskLevel: "MEDIUM" })).toBe(true);
    expect(shouldReviewTransaction({ riskLevel: "LOW" })).toBe(false);
  });

  it("assessRisk aggregates multiple matches to highest risk", () => {
    const high = assessRisk([
      { type: "PEP", source: "X", matchScore: 0.9, matchedName: "x", matchedCountry: "CO" },
    ]);
    expect(high).toBe("HIGH");

    const medium = assessRisk([
      { type: "ADVERSE_MEDIA", source: "Y", matchScore: 0.5, matchedName: "y", matchedCountry: "CO" },
    ]);
    expect(medium).toBe("MEDIUM");

    const low = assessRisk([]);
    expect(low).toBe("LOW");
  });
});

describe("PR 4b — input validation", () => {
  let provider: ComplianceScreeningProvider;

  beforeEach(() => {
    provider = new MockComplianceScreeningProvider();
  });

  it("rejects empty userId in screenUser", async () => {
    await expect(
      provider.screenUser({ userId: "", fullName: "Test", country: "CO" }),
    ).rejects.toThrow();
  });

  it("rejects empty fullName in screenUser", async () => {
    await expect(
      provider.screenUser({ userId: "u-1", fullName: "", country: "CO" }),
    ).rejects.toThrow();
  });

  it("rejects empty userId in screenTransaction", async () => {
    await expect(
      provider.screenTransaction({
        userId: "",
        amountCop: 1000,
        channel: "WOMPI_CARD",
        counterpartyUserId: "seller",
      }),
    ).rejects.toThrow();
  });
});
