import { describe, expect, it } from "vitest";
import { computeRnbdWindow, formatRnbdAlert } from "../lib/dpo-tools/rnbd-window.js";

describe("rnbd-window (compliance-foundation PR 4 task 4.2)", () => {
  describe("computeRnbdWindow", () => {
    it("returns in_window=true on 15 January", () => {
      const state = computeRnbdWindow(new Date("2026-01-15T12:00:00Z"));
      expect(state.in_window).toBe(true);
      expect(state.reference_year).toBe(2026);
      expect(state.days_until_close).toBeGreaterThan(0);
      expect(state.window_start.startsWith("2026-01-02")).toBe(true);
      expect(state.window_end.startsWith("2026-03-31")).toBe(true);
    });

    it("returns in_window=true on 31 March (last day)", () => {
      const state = computeRnbdWindow(new Date("2026-03-31T12:00:00Z"));
      expect(state.in_window).toBe(true);
    });

    it("returns in_window=false on 1 January (window opens 2 Jan)", () => {
      const state = computeRnbdWindow(new Date("2026-01-01T12:00:00Z"));
      expect(state.in_window).toBe(false);
    });

    it("returns in_window=false on 1 April (window closed)", () => {
      const state = computeRnbdWindow(new Date("2026-04-01T12:00:00Z"));
      expect(state.in_window).toBe(false);
    });

    it("returns in_window=false in mid-year (June)", () => {
      const state = computeRnbdWindow(new Date("2026-06-15T12:00:00Z"));
      expect(state.in_window).toBe(false);
    });
  });

  describe("formatRnbdAlert", () => {
    it("includes key dates and SIC reference", () => {
      const text = formatRnbdAlert({
        in_window: true,
        days_until_close: 45,
        window_start: "2026-01-02T00:00:00.000Z",
        window_end: "2026-03-31T23:59:59.000Z",
        reference_year: 2026,
      });
      expect(text).toContain("2026-01-02");
      expect(text).toContain("2026-03-31");
      expect(text).toContain("45");
      expect(text).toMatch(/SIC/);
      expect(text).toMatch(/Decreto 886\/2014/);
    });
  });

  describe("handler stub", () => {
    it("exports handler for SST to wire", async () => {
      const mod = await import("../lib/dpo-tools/rnbd-window.handler.js");
      expect(typeof mod.handler).toBe("function");
    });
  });
});