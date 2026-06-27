/**
 * Withdrawal cooling-off period (PR 5 — closes OPL-COMP-008).
 *
 * Decreto 222/2020 Art. 4: closed-loop wallet deposits require a 5-day
 * holding period before withdrawal. This prevents "procedencia de fondos"
 * violations and helps UIAF SAR detection (rapid deposit-withdraw cycles).
 *
 * Per-deposit tracking: oldest unreleased deposit determines eligibility.
 * Tier 4 unlimited withdrawal exemption only applies after 5-day cooling-off.
 */

import { WithdrawHoldNotElapsedError } from "./errors.js";

/** 5 days per Decreto 222/2020 Art. 4. */
export const COOLING_OFF_DAYS = 5;

/** 5 days in milliseconds. */
export const COOLING_OFF_PERIOD_MS = COOLING_OFF_DAYS * 24 * 60 * 60 * 1000;

export interface WithdrawalCheckInput {
  userId: string;
  amountCop: number;
  /**
   * ISO timestamp of the oldest unreleased deposit in the wallet.
   * If null/undefined, no deposits to check (treated as no cooling-off).
   */
  oldestUnreleasedDepositIso?: string;
  /** ISO timestamp of "now" (for deterministic tests). */
  nowIso: string;
}

/**
 * Returns true if the oldest deposit is within the 5-day cooling-off period.
 */
export function isWithinCoolingOff(
  oldestUnreleasedDepositIso: string,
  nowIso: string | number = Date.now(),
): boolean {
  const oldestMs = new Date(oldestUnreleasedDepositIso).getTime();
  const nowMs = typeof nowIso === "string" ? new Date(nowIso).getTime() : nowIso;
  return nowMs - oldestMs < COOLING_OFF_PERIOD_MS;
}

/**
 * Check if a withdrawal is allowed under the cooling-off policy.
 *
 * - If no deposits (oldestUnreleasedDepositIso undefined): ALLOW.
 * - If oldest deposit is within 5 days: REJECT (throws WithdrawHoldNotElapsedError).
 * - If oldest deposit is >= 5 days old: ALLOW.
 */
export function canWithdraw(input: WithdrawalCheckInput): void {
  if (!input.oldestUnreleasedDepositIso) {
    return; // No deposits — allow (defensive)
  }
  if (isWithinCoolingOff(input.oldestUnreleasedDepositIso, input.nowIso)) {
    const availableAtMs = new Date(input.oldestUnreleasedDepositIso).getTime() + COOLING_OFF_PERIOD_MS;
    const hoursRemaining = Math.ceil((availableAtMs - new Date(input.nowIso).getTime()) / (60 * 60 * 1000));
    throw new WithdrawHoldNotElapsedError(
      `Withdrawal requires 5-day cooling-off (Decreto 222/2020). Available at ${new Date(availableAtMs).toISOString()}.`,
      new Date(availableAtMs).toISOString(),
      hoursRemaining,
    );
  }
}
