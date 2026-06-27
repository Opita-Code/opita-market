import { isNonBusinessDay } from "./colombian-holidays.js";

/**
 * SLA calendar for Ley 1581/2012 Art. 11 — titular rights requests MUST be
 * answered within 15 business days of verified submission.
 *
 * Business day = Mon-Fri excluding Colombian holidays (see colombian-holidays.ts).
 *
 * All date math uses UTC to avoid timezone drift across Lambda regions.
 */

/** Ley 1581/2012 Art. 11 — 15 business days SLA for titular rights. */
export const RIGHTS_SLA_BUSINESS_DAYS = 15;

/**
 * Compute the SLA deadline for a rights request received at `start`.
 * Returns a Date `businessDays` business days after `start`, skipping
 * Sat/Sun and Colombian holidays. If `start` falls on a non-business day,
 * the deadline still starts from `start` (we just skip the weekends/holidays
 * when counting forward).
 */
export function computeSlaDeadline(
  start: Date | string,
  businessDays: number = RIGHTS_SLA_BUSINESS_DAYS,
): Date {
  if (!Number.isInteger(businessDays) || businessDays < 1) {
    throw new Error(`SLA businessDays must be a positive integer, got ${businessDays}`);
  }
  const cursor = new Date(typeof start === "string" ? `${start.slice(0, 10)}T00:00:00Z` : start);
  let counted = 0;
  // Advance at least 1 calendar day; the while loop skips non-business days.
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (counted < businessDays) {
    if (!isNonBusinessDay(cursor)) {
      counted++;
    }
    if (counted < businessDays) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return cursor;
}

/** True when `now` is strictly past `deadline`. */
export function isSlaBreached(deadline: Date | string, now: Date = new Date()): boolean {
  const dl = typeof deadline === "string" ? new Date(deadline) : deadline;
  return now.getTime() > dl.getTime();
}

/** Business days elapsed between two dates (inclusive of start, exclusive of end). */
export function businessDaysBetween(start: Date | string, end: Date | string): number {
  const s = new Date(typeof start === "string" ? `${start.slice(0, 10)}T00:00:00Z` : start);
  const e = new Date(typeof end === "string" ? `${end.slice(0, 10)}T00:00:00Z` : end);
  if (e.getTime() <= s.getTime()) return 0;
  let days = 0;
  const cursor = new Date(s);
  while (cursor.getTime() < e.getTime()) {
    if (!isNonBusinessDay(cursor)) days++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}