/**
 * Withdrawal cooling-off period (PR 5 — closes OPL-COMP-008, PR 7 — closes OPL-CARD-008).
 *
 * Decreto 222/2020 Art. 4: closed-loop wallet deposits require a 5-day
 * holding period before withdrawal. This prevents "procedencia de fondos"
 * violations and helps UIAF SAR detection (rapid deposit-withdraw cycles).
 *
 * Per-deposit tracking (PR 7 — closes OPL-CARD-008):
 *   - Each DEPOSITO ledger entry carries a `held_until` field
 *   - The OLDEST unreleased DEPOSITO determines withdrawal eligibility
 *   - Tier 4 unlimited withdrawal exemption only applies after 5-day cooling-off
 *
 * Old tier-based logic (`withdrawHoldFor(tier, amount)`) was removed from
 * the wallet route in PR 7 — Decreto 222 T+0 violation for Tier 3-4.
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

// ─── PR 7 — Per-deposit hold tracking (closes OPL-CARD-008) ──────────────────

/**
 * Compute the held_until timestamp for a deposit (createdAt + 5 days).
 *
 * Used by CreditWalletUseCase when writing DEPOSITO entries to the ledger.
 * Each DEPOSITO entry stores both `created_at` and `held_until` so the
 * withdrawal flow can find the oldest unreleased deposit.
 */
export function computeHeldUntilIso(createdAtIso: string): string {
  if (!createdAtIso) throw new Error("createdAtIso is required");
  const createdAtMs = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdAtMs)) throw new Error(`Invalid createdAtIso: ${createdAtIso}`);
  return new Date(createdAtMs + COOLING_OFF_PERIOD_MS).toISOString();
}

/**
 * Ledger entry shape used by getOldestUnreleasedDeposit.
 * Subset of MarketLedgerEntry — only the fields we need.
 */
export interface LedgerEntryForHold {
  user_id: string;
  ts_seq: string;
  movement: string;
  amount_cop: number;
  held_until?: string;
  released?: boolean;
}

export interface OldestDepositInput {
  userId: string;
  nowMs: number;
}

export interface OldestDepositDeps {
  /** Document client used to query the LedgerTable. */
  queryClient: { send: (cmd: any) => Promise<{ Items?: LedgerEntryForHold[] }> };
  /** Name of the LedgerTable. */
  ledgerTableName: string;
}

/**
 * Find the oldest UN-RELEASED DEPOSITO entry in the user's ledger.
 *
 * Logic:
 *   1. Query LedgerTable by user_id (primary key), sorted by ts_seq ascending.
 *   2. Filter to entries where movement === 'DEPOSITO' AND released !== true.
 *   3. Filter to entries where held_until > nowMs (still within cooling-off window).
 *      If held_until is undefined, the entry is treated as released (legacy data).
 *   4. Return the OLDEST (smallest ts_seq) of the filtered set.
 *
 * Returns null if:
 *   - No DEPOSITO entries exist
 *   - All DEPOSITO entries are released
 *   - All DEPOSITO entries are past their held_until (caller can withdraw)
 *
 * SECURITY:
 *   - Read-only operation (no mutations).
 *   - No PII returned (just the entry metadata).
 */
export async function getOldestUnreleasedDeposit(
  input: OldestDepositInput,
  deps: OldestDepositDeps,
): Promise<LedgerEntryForHold | null> {
  const result = await deps.queryClient.send({
    TableName: deps.ledgerTableName,
    KeyConditionExpression: "user_id = :uid",
    ExpressionAttributeValues: { ":uid": input.userId },
    // ScanIndexForward=true (default) returns oldest first (ascending by sort key)
    ScanIndexForward: true,
    Limit: 100, // safety cap — typically <10 deposits in window
  });

  const items = result.Items ?? [];
  // Defensive sort by ts_seq ascending (oldest first).
  // DDB returns ascending when ScanIndexForward=true, but we sort here to
  // protect against future changes / inconsistent caller behavior.
  items.sort((a, b) => (a.ts_seq < b.ts_seq ? -1 : a.ts_seq > b.ts_seq ? 1 : 0));
  const oldest = items.find((entry) => {
    if (entry.movement !== "DEPOSITO") return false;
    if (entry.released === true) return false;
    if (!entry.held_until) return false;
    const heldUntilMs = new Date(entry.held_until).getTime();
    return heldUntilMs > input.nowMs;
  });

  return oldest ?? null;
}
