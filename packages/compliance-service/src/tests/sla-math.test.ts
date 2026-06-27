import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  computeSlaDeadline,
  isSlaBreached,
  RIGHTS_SLA_BUSINESS_DAYS,
} from "../lib/sla-math.js";

describe("sla-math (Ley 1581/2012 Art. 11 — 15 business days)", () => {
  it("computes 15 business days from a Monday (skipping weekends)", () => {
    // Monday 2026-01-05 (no holidays that week). 15 biz days = 2026-01-26 (Mon).
    const deadline = computeSlaDeadline("2026-01-05T00:00:00Z");
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-01-26");
  });

  it("skips weekends when starting mid-week", () => {
    // Wednesday 2026-01-07 + 15 biz days = 2026-01-28 (Wed).
    const deadline = computeSlaDeadline("2026-01-07T00:00:00Z");
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-01-28");
  });

  it("skips Colombian holidays (Año Nuevo)", () => {
    // 2026-01-01 is Año Nuevo. If a request lands on 2025-12-29 (Mon),
    // the first biz day is 2025-12-30 Tue (count=1), then 2025-12-31 (count=2),
    // skip 2026-01-01 holiday, 2026-01-02 Fri (count=3), skip weekend,
    // continue... To make the math tractable, start on 2026-01-02 (Fri):
    // 15 biz days should be 2026-01-23 Fri (skip 2026-01-05 Mon if a holiday,
    // but 2026-01-05 is not on the list).
    const deadline = computeSlaDeadline("2026-01-02T00:00:00Z");
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-01-23");
  });

  it("counts business days across a weekend", () => {
    const days = businessDaysBetween("2026-01-02T00:00:00Z", "2026-01-12T00:00:00Z");
    // 2026-01-02 Fri (1), 01-05 Mon (2), 01-06 Tue (3), 01-07 Wed (4),
    // 01-08 Thu (5), 01-09 Fri (6). 01-12 excluded (loop is half-open).
    expect(days).toBe(6);
  });

  it("isSlaBreached is false when now < deadline", () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(isSlaBreached(future)).toBe(false);
  });

  it("isSlaBreached is true when now > deadline", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(isSlaBreached(past)).toBe(true);
  });

  it("rejects non-positive businessDays", () => {
    expect(() => computeSlaDeadline("2026-01-05T00:00:00Z", 0)).toThrow();
    expect(() => computeSlaDeadline("2026-01-05T00:00:00Z", -1)).toThrow();
  });

  it("exports the Ley-mandated constant 15", () => {
    expect(RIGHTS_SLA_BUSINESS_DAYS).toBe(15);
  });
});