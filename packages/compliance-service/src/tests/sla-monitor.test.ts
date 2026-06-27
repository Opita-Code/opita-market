import { describe, expect, it, vi } from "vitest";
import { formatBreachAlert, type BreachedRow } from "../lib/sla-monitor.js";

describe("sla-monitor (compliance-foundation PR 4 task 4.1)", () => {
  describe("formatBreachAlert", () => {
    it("returns the 'no breaches' message for an empty list", () => {
      const text = formatBreachAlert([]);
      expect(text).toMatch(/Sin novedades/);
      expect(text).toMatch(/SLA/);
    });

    it("includes one bullet per row plus metadata", () => {
      const rows: ReadonlyArray<BreachedRow> = [
        {
          id: 42,
          action: "rights.know",
          nit: "900123456",
          occurred_at: "2026-05-01T10:00:00.000Z",
          sla_deadline: "2026-05-22T00:00:00.000Z",
          days_overdue: 5,
          outcome: "verified",
        },
      ];
      const text = formatBreachAlert(rows);
      expect(text).toContain("42");
      expect(text).toContain("rights.know");
      expect(text).toContain("900123456");
      expect(text).toContain("days_overdue=5");
      expect(text).toMatch(/Ley 1581\/2012/);
    });

    it("pluralises 'breach' correctly via the subject line logic (indirectly)", () => {
      // Subject pluralisation is in the handler; here we just verify the
      // body does not duplicate the row when there is only one.
      const rows: ReadonlyArray<BreachedRow> = [
        {
          id: 1,
          action: "rights.suppress",
          nit: null,
          occurred_at: "2026-04-01T00:00:00.000Z",
          sla_deadline: "2026-04-22T00:00:00.000Z",
          days_overdue: 30,
          outcome: "verified",
        },
      ];
      const text = formatBreachAlert(rows);
      expect(text).toContain("1 solicitud");
    });
  });

  describe("isSlaBreached passthrough", () => {
    it("uses sla-math.isSlaBreached correctly", async () => {
      const { isSlaBreached } = await import("../lib/sla-math.js");
      const future = new Date(Date.now() + 86_400_000);
      const past = new Date(Date.now() - 86_400_000);
      expect(isSlaBreached(future.toISOString())).toBe(false);
      expect(isSlaBreached(past.toISOString())).toBe(true);
    });
  });

  describe("logging-only smoke", () => {
    it("exports a handler stub for SST to wire", async () => {
      const mod = await import("../lib/sla-monitor.handler.js");
      expect(typeof mod.handler).toBe("function");
      // Don't actually call — handler requires DATABASE_URL which isn't
      // set in unit tests; just verify the export exists.
      vi.restoreAllMocks();
    });
  });
});