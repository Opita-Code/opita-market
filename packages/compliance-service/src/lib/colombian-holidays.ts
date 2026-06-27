/**
 * Colombian holidays for SLA calendar (Ley 1581/2012 Art. 11 — 15 business days).
 *
 * Static list — update each calendar year in advance. Source: calendario oficial
 * de Colombia (MinCIT). Format: ISO date (YYYY-MM-DD).
 *
 * NOTE: For 2026, the list below reflects the standard national holiday calendar
 * (Ley Emiliani moveable holidays applied). When the operator finalizes the
 * 2026 calendario via MinCIT, replace this array with the verified list.
 * Tests pin against the dates below and must be updated together.
 */
export const COLOMBIAN_HOLIDAYS_2026: ReadonlyArray<string> = [
  "2026-01-01", // Año Nuevo
  "2026-03-23", // Día de San José (Ley Emiliani — moveable from 19 Mar)
  "2026-03-30", // Semana Santa — Lunes (movable, see MinCIT calendar)
  "2026-04-01", // Semana Santa — Miércoles (movable)
  "2026-05-01", // Día del Trabajo
  "2026-05-18", // Ascensión del Señor (Ley Emiliani, moveable from 29 May)
  "2026-06-08", // Corpus Christi (Ley Emiliani, moveable from 19 Jun)
  "2026-06-29", // Sagrado Corazón / San Pedro y San Pablo (Ley Emiliani, moveable from 23 Jun)
  "2026-07-20", // Día de la Independencia
  "2026-08-07", // Batalla de Boyacá
  "2026-08-17", // Asunción de la Virgen (Ley Emiliani, moveable from 15 Aug)
  "2026-10-12", // Día de la Raza / Encuentro de Culturas
  "2026-11-02", // Día de los Difuntos
  "2026-11-16", // Independencia de Cartagena (Ley Emiliani, moveable from 11 Nov)
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
];

export const COLOMBIAN_HOLIDAY_SET_2026: ReadonlySet<string> = new Set(COLOMBIAN_HOLIDAYS_2026);

/**
 * Returns true when the given date (in ISO YYYY-MM-DD or Date) is a Colombian
 * holiday OR a weekend (Sat/Sun). Used by SLA business-day math.
 *
 * Only 2026 is fully enumerated; out-of-range years default to "weekend check
 * only" until the operator publishes the next year's calendar. This is
 * deliberate — failing closed (counting weekends only) is safer than failing
 * open (treating unknown holidays as business days).
 */
export function isNonBusinessDay(date: Date | string, year: number = 2026): boolean {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) return true;

  if (year === 2026) {
    const iso = d.toISOString().slice(0, 10);
    return COLOMBIAN_HOLIDAY_SET_2026.has(iso);
  }
  return false;
}