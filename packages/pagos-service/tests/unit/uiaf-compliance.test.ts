import { describe, it, expect, beforeEach } from "vitest";
import {
  UiafMonitor,
  THRESHOLD_COP,
  THRESHOLD_BY_CHANNEL,
  detectStructuring,
  isStructuringAmount,
  generateSar,
  validateSar,
  type UiafTransaction,
  type UiafAlerter,
} from "../../src/crons/uiaf-monitor.js";
import { InMemoryUiafReportsStore, type UiafReportsStore, type SarRecord } from "../../src/lib/uiaf-reports.js";

/**
 * Tests for PR 4a — UIAF cron wiring + SAR + structuring + channel thresholds.
 *
 * Closes:
 *   - OPL-COMP-014 (UIAF cron handler not wired)
 *   - OPL-COMP-015 (no SAR filing)
 *   - OPL-COMP-016 (no structuring detection)
 *   - OPL-COMP-017 (no 10M threshold for non-cash / Nequi / Daviplata)
 *
 * Spec: openspec/changes/pre-deploy-remediation/tasks.md PR 4.1
 *       openspec/changes/opita-pagos-foundation/pentest-evidence/08-llm-compliance.json
 */

describe("PR 4a — channel-specific thresholds (closes OPL-COMP-017)", () => {
  it("WOMPI_CARD threshold is 5M COP (cash equivalent)", () => {
    expect(THRESHOLD_BY_CHANNEL.WOMPI_CARD).toBe(5_000_000);
  });

  it("WOMPI_BREB threshold is 5M COP (cash equivalent)", () => {
    expect(THRESHOLD_BY_CHANNEL.WOMPI_BREB).toBe(5_000_000);
  });

  it("WOMPI_PSE threshold is 10M COP (non-cash per Decreto 2358/2020)", () => {
    expect(THRESHOLD_BY_CHANNEL.WOMPI_PSE).toBe(10_000_000);
  });

  it("WOMPI_NEQUI threshold is 10M COP (non-cash)", () => {
    expect(THRESHOLD_BY_CHANNEL.WOMPI_NEQUI).toBe(10_000_000);
  });

  it("WOMPI_DAVIPLATA threshold is 10M COP (non-cash)", () => {
    expect(THRESHOLD_BY_CHANNEL.WOMPI_DAVIPLATA).toBe(10_000_000);
  });

  it("THRESHOLD_COP default remains 5M for backward compat", () => {
    expect(THRESHOLD_COP).toBe(5_000_000);
  });
});

describe("PR 4a — UiafMonitor with channel-aware thresholds", () => {
  let sentAlerts: Array<{ userId: string; total: number; channel: string }>;

  beforeEach(() => {
    sentAlerts = [];
  });

  it("flags WOMPI_CARD user at 5M cumulative (per channel threshold)", async () => {
    const monitor = new UiafMonitor({
      store: { getRecentTransactions: async () => fakeTxs("u1", "WOMPI_CARD", [3_000_000, 2_000_000]) },
      alerter: { sendAlert: async (u, t) => { sentAlerts.push({ userId: u, total: t, channel: "WOMPI_CARD" }); } },
    });
    const r = await monitor.run();
    expect(r.flagged).toBe(1);
    expect(sentAlerts[0].total).toBe(5_000_000);
  });

  it("does NOT flag WOMPI_PSE user at 5M (below 10M non-cash threshold)", async () => {
    const monitor = new UiafMonitor({
      store: { getRecentTransactions: async () => fakeTxs("u2", "WOMPI_PSE", [3_000_000, 2_000_000]) },
      alerter: { sendAlert: async (u, t) => { sentAlerts.push({ userId: u, total: t, channel: "WOMPI_PSE" }); } },
    });
    const r = await monitor.run();
    expect(r.flagged).toBe(0);
  });

  it("flags WOMPI_PSE user at 10M cumulative", async () => {
    const monitor = new UiafMonitor({
      store: { getRecentTransactions: async () => fakeTxs("u3", "WOMPI_PSE", [6_000_000, 4_000_000]) },
      alerter: { sendAlert: async (u, t) => { sentAlerts.push({ userId: u, total: t, channel: "WOMPI_PSE" }); } },
    });
    const r = await monitor.run();
    expect(r.flagged).toBe(1);
  });

  it("flags Nequi user at 10M (5M would NOT flag — non-cash threshold)", async () => {
    const monitor = new UiafMonitor({
      store: { getRecentTransactions: async () => fakeTxs("u4", "WOMPI_NEQUI", [5_000_000]) },
      alerter: { sendAlert: async (u, t) => { sentAlerts.push({ userId: u, total: t, channel: "WOMPI_NEQUI" }); } },
    });
    const r = await monitor.run();
    expect(r.flagged).toBe(0); // 5M Nequi < 10M threshold

    const monitor2 = new UiafMonitor({
      store: { getRecentTransactions: async () => fakeTxs("u4", "WOMPI_NEQUI", [10_000_000]) },
      alerter: { sendAlert: async (u, t) => { sentAlerts.push({ userId: u, total: t, channel: "WOMPI_NEQUI" }); } },
    });
    const r2 = await monitor2.run();
    expect(r2.flagged).toBe(1);
  });

  it("aggregates same user across multiple channels correctly (per-channel)", async () => {
    // 3M card + 3M PSE = 6M total. Card channel at 3M (under 5M), PSE at 3M (under 10M). Neither flagged.
    const txs: UiafTransaction[] = [
      ...fakeTxs("u5", "WOMPI_CARD", [3_000_000]),
      ...fakeTxs("u5", "WOMPI_PSE", [3_000_000]),
    ];
    const monitor = new UiafMonitor({
      store: { getRecentTransactions: async () => txs },
      alerter: { sendAlert: async (u, t) => { sentAlerts.push({ userId: u, total: t, channel: "mixed" }); } },
    });
    const r = await monitor.run();
    // Per-channel aggregation: WOMPI_CARD channel total = 3M (no flag), WOMPI_PSE = 3M (no flag)
    expect(r.flagged).toBe(0);
  });
});

describe("PR 4a — structuring detection (closes OPL-COMP-016)", () => {
  it("isStructuringAmount returns true for amounts in [900k, 1M) range", () => {
    expect(isStructuringAmount(900_000)).toBe(true);
    expect(isStructuringAmount(950_000)).toBe(true);
    expect(isStructuringAmount(999_999)).toBe(true);
  });

  it("isStructuringAmount returns false outside structuring range", () => {
    expect(isStructuringAmount(800_000)).toBe(false);
    expect(isStructuringAmount(1_000_000)).toBe(false);
    expect(isStructuringAmount(5_000_000)).toBe(false);
  });

  it("detectStructuring flags user with 5+ structuring-amount txs in 24h", () => {
    const txs = fakeTxs("u6", "WOMPI_CARD", [
      950_000, 950_000, 950_000, 950_000, 950_000,
    ]);
    const result = detectStructuring(txs, { windowHours: 24, minCount: 5 });
    expect(result.flagged).toContain("u6");
    expect(result.reasons.get("u6")?.toLowerCase()).toContain("structuring");
  });

  it("detectStructuring does NOT flag user with only 4 structuring-amount txs", () => {
    const txs = fakeTxs("u7", "WOMPI_CARD", [
      950_000, 950_000, 950_000, 950_000,
    ]);
    const result = detectStructuring(txs, { windowHours: 24, minCount: 5 });
    expect(result.flagged).not.toContain("u7");
  });

  it("detectStructuring does NOT flag user with 5+ non-structuring txs", () => {
    const txs = fakeTxs("u8", "WOMPI_CARD", [
      100_000, 100_000, 100_000, 100_000, 100_000,
    ]);
    const result = detectStructuring(txs, { windowHours: 24, minCount: 5 });
    expect(result.flagged).not.toContain("u8");
  });
});

describe("PR 4a — SAR generation (closes OPL-COMP-015)", () => {
  it("generateSar produces all required UIAF fields", () => {
    const sar = generateSar({
      sarId: "sar-001",
      userId: "u9",
      totalAmountCop: 5_500_000,
      transactions: fakeTxs("u9", "WOMPI_CARD", [3_000_000, 2_500_000]),
      reason: "VOLUME_THRESHOLD_EXCEEDED",
      generatedAtIso: "2026-06-27T10:00:00Z",
    });
    expect(sar.sarId).toBe("sar-001");
    expect(sar.userId).toBe("u9");
    expect(sar.totalAmountCop).toBe(5_500_000);
    expect(sar.reason).toBe("VOLUME_THRESHOLD_EXCEEDED");
    expect(sar.transactions.length).toBe(2);
    expect(sar.status).toBe("PENDING_FILING");
    expect(sar.uiafReferenceNumber).toMatch(/^SAR-/);
    expect(sar.xmlPayload).toContain("<UIAFSAR");
    expect(sar.xmlPayload).toContain("u9");
  });

  it("validateSar returns true for well-formed SAR", () => {
    const sar = generateSar({
      sarId: "sar-002",
      userId: "u10",
      totalAmountCop: 6_000_000,
      transactions: fakeTxs("u10", "WOMPI_CARD", [6_000_000]),
      reason: "VOLUME_THRESHOLD_EXCEEDED",
      generatedAtIso: "2026-06-27T10:00:00Z",
    });
    expect(validateSar(sar)).toEqual({ valid: true });
  });

  it("validateSar returns error for SAR with zero transactions", () => {
    const sar = generateSar({
      sarId: "sar-003",
      userId: "u11",
      totalAmountCop: 5_000_000,
      transactions: [],
      reason: "VOLUME_THRESHOLD_EXCEEDED",
      generatedAtIso: "2026-06-27T10:00:00Z",
    });
    const result = validateSar(sar);
    expect(result.valid).toBe(false);
    expect(result.error?.toLowerCase()).toContain("transaction");
  });
});

describe("PR 4a — InMemoryUiafReportsStore", () => {
  it("save() persists SAR and list() returns it", async () => {
    const store = new InMemoryUiafReportsStore();
    const sar: SarRecord = {
      sarId: "sar-test",
      userId: "u12",
      totalAmountCop: 5_000_000,
      transactions: fakeTxs("u12", "WOMPI_CARD", [5_000_000]),
      reason: "VOLUME_THRESHOLD_EXCEEDED",
      generatedAtIso: "2026-06-27T10:00:00Z",
      status: "PENDING_FILING",
      uiafReferenceNumber: "SAR-2026-001",
      xmlPayload: "<xml/>",
    };
    await store.save(sar);
    const list = await store.list({ status: "PENDING_FILING" });
    expect(list).toHaveLength(1);
    expect(list[0].sarId).toBe("sar-test");
  });

  it("list() filters by status", async () => {
    const store = new InMemoryUiafReportsStore();
    const mkSar = (id: string, status: SarRecord["status"]): SarRecord => ({
      sarId: id,
      userId: "u13",
      totalAmountCop: 5_000_000,
      transactions: fakeTxs("u13", "WOMPI_CARD", [5_000_000]),
      reason: "VOLUME_THRESHOLD_EXCEEDED",
      generatedAtIso: "2026-06-27T10:00:00Z",
      status,
      uiafReferenceNumber: `SAR-${id}`,
      xmlPayload: "<xml/>",
    });
    await store.save(mkSar("a", "PENDING_FILING"));
    await store.save(mkSar("b", "FILED"));

    const pending = await store.list({ status: "PENDING_FILING" });
    expect(pending.map((s) => s.sarId)).toEqual(["a"]);

    const filed = await store.list({ status: "FILED" });
    expect(filed.map((s) => s.sarId)).toEqual(["b"]);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function fakeTxs(userId: string, channel: string, amounts: number[]): UiafTransaction[] {
  return amounts.map((amount, i) => ({
    transaction_id: `tx-${userId}-${channel}-${i}`,
    user_id: userId,
    amount_cop: amount,
    created_at: new Date(Date.now() - i * 60_000).toISOString(),
    channel,
    status: "APPROVED",
  }));
}
