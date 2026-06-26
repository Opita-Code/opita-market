import { describe, expect, it } from "vitest";
import {
  halfOfYear,
  computeStats,
  renderReport,
  type ComplaintReportRow,
} from "../lib/dpo-tools/complaint-report.js";

describe("complaint-report (compliance-foundation PR 4 task 4.3)", () => {
  describe("halfOfYear", () => {
    it("returns H1 for dates Jan-Jun", () => {
      const w = halfOfYear(new Date("2026-04-15T12:00:00Z"));
      expect(w.half).toBe("H1");
      expect(w.year).toBe(2026);
      expect(w.start.toISOString().slice(0, 10)).toBe("2026-01-01");
      expect(w.end.toISOString().slice(0, 10)).toBe("2026-06-30");
    });

    it("returns H2 for dates Jul-Dec", () => {
      const w = halfOfYear(new Date("2026-10-01T12:00:00Z"));
      expect(w.half).toBe("H2");
      expect(w.year).toBe(2026);
      expect(w.start.toISOString().slice(0, 10)).toBe("2026-07-01");
      expect(w.end.toISOString().slice(0, 10)).toBe("2026-12-31");
    });

    it("boundary: 1 July is H2", () => {
      const w = halfOfYear(new Date("2026-07-01T00:00:00Z"));
      expect(w.half).toBe("H2");
    });
  });

  describe("computeStats", () => {
    it("handles an empty list", () => {
      const s = computeStats([]);
      expect(s.total_complaints).toBe(0);
      expect(s.avg_business_days_to_resolve).toBeNull();
      expect(s.max_business_days_to_resolve).toBeNull();
    });

    it("counts resolved/unresolved/breached", () => {
      const rows: ReadonlyArray<ComplaintReportRow> = [
        mkRow("n1", "1", "rights.know", "completed", 5, false),
        mkRow("n2", "2", "rights.suppress", "completed", 20, true),
        mkRow("n3", "3", "rights.update", "verified", null, false),
      ];
      const s = computeStats(rows);
      expect(s.total_complaints).toBe(3);
      expect(s.resolved).toBe(2);
      expect(s.unresolved).toBe(1);
      expect(s.breached).toBe(1);
      expect(s.avg_business_days_to_resolve).toBe(12.5);
      expect(s.max_business_days_to_resolve).toBe(20);
    });
  });

  describe("renderReport", () => {
    it("renders a markdown report with NIT+DV rows", () => {
      const md = renderReport({
        half: "H1",
        year: 2026,
        period_start: "2026-01-01T00:00:00.000Z",
        period_end: "2026-06-30T23:59:59.000Z",
        generated_at: "2026-08-24T11:00:00.000Z",
        stats: {
          total_complaints: 2,
          resolved: 2,
          unresolved: 0,
          breached: 0,
          avg_business_days_to_resolve: 7.5,
          max_business_days_to_resolve: 12,
        },
        complaints: [
          mkRow("900111111", "1", "rights.know", "completed", 3, false),
          mkRow("900222222", "2", "rights.update", "completed", 12, false),
        ],
      });
      expect(md).toMatch(/H1 2026/);
      expect(md).toContain("900111111");
      expect(md).toContain("900222222");
      expect(md).toMatch(/SIC/);
      expect(md).toMatch(/25 de agosto/);
    });

    it("uses the H2 deadline text for H2 reports", () => {
      const md = renderReport({
        half: "H2",
        year: 2025,
        period_start: "2025-07-01T00:00:00.000Z",
        period_end: "2025-12-31T23:59:59.000Z",
        generated_at: "2026-02-24T11:00:00.000Z",
        stats: {
          total_complaints: 0,
          resolved: 0,
          unresolved: 0,
          breached: 0,
          avg_business_days_to_resolve: null,
          max_business_days_to_resolve: null,
        },
        complaints: [],
      });
      expect(md).toMatch(/28 de febrero/);
    });
  });

  describe("handler stub", () => {
    it("exports handler for SST to wire", async () => {
      const mod = await import("../lib/dpo-tools/complaint-report.handler.js");
      expect(typeof mod.handler).toBe("function");
    });
  });
});

function mkRow(
  nit: string,
  dv: string,
  requestType: string,
  outcome: string,
  businessDays: number | null,
  breached: boolean,
): ComplaintReportRow {
  return {
    nit,
    dv,
    request_type: requestType,
    received_at: "2026-03-15T10:00:00.000Z",
    resolved_at: outcome === "completed" || outcome === "failed" ? "2026-03-20T10:00:00.000Z" : null,
    business_days_to_resolve: businessDays,
    outcome,
    sla_breached: breached,
  };
}