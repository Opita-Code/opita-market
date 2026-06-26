/**
 * Pure helper that computes the RNBD (Registro Nacional de Bases de Datos)
 * annual update window per spec/data-protection-compliance requirement
 * "Annual RNBD Update": every year, between 2 January and 31 March.
 *
 * Returns the window state for the supplied reference date (defaults to
 * `new Date()`). Used both by the DPO dashboard widget AND by the SLA
 * monitor (PR 4) to drive SES alerts.
 */
export interface RnbdWindow {
  in_window: boolean;
  days_until_open: number;
  days_until_close: number;
  window_start: string;
  window_end: string;
}

export function computeRnbdWindow(now: Date = new Date()): RnbdWindow {
  const year = now.getUTCFullYear();
  const windowStart = new Date(Date.UTC(year, 0, 2)); // 2 Jan
  const windowEnd = new Date(Date.UTC(year, 2, 31, 23, 59, 59)); // 31 Mar

  const msPerDay = 1000 * 60 * 60 * 24;
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const nowMs = now.getTime();

  const inWindow = nowMs >= startMs && nowMs <= endMs;

  // If we're past the window for this year, compute distance to NEXT year's window.
  let targetStart = startMs;
  if (nowMs > endMs) {
    targetStart = Date.UTC(year + 1, 0, 2);
  }

  const daysUntilOpen = Math.ceil((targetStart - nowMs) / msPerDay);
  const daysUntilClose = inWindow
    ? Math.ceil((endMs - nowMs) / msPerDay)
    : 0;

  return {
    in_window: inWindow,
    days_until_open: Math.max(0, daysUntilOpen),
    days_until_close: Math.max(0, daysUntilClose),
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
  };
}