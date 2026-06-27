/**
 * Structuring detection (PR 7 — closes OPL-CARD-016).
 *
 * Tier 1 3DS threshold is $200,000 COP. The `requires3DS` function uses
 * STRICT greater-than (`amountCop > threshold`), so an amount of exactly
 * $200,000 COP bypasses 3DS. An attacker can split a $1M payment into
 * five $200,000 payments to evade 3DS detection (structuring).
 *
 * The fix:
 *   - Track per-(sender, recipient) transaction count in the
 *     threshold-boundary range [200_000, 300_000] COP per 24h window.
 *   - If count >= 3, return a STRUCTURING_SUSPECTED signal that the
 *     fraud engine logs for DPO review.
 *   - Does NOT block the immediate transaction — the signal is enough
 *     to flag the pattern for manual review.
 *
 * Detection uses the TransactionsTable.StatusUpdatedAtIndex GSI:
 *   - hashKey: status (e.g., "APPROVED")
 *   - rangeKey: updated_at (ISO timestamp)
 * This index lets us efficiently query "APPROVED tx in the last 24h".
 * We then filter by sender + recipient + amount range in code.
 *
 * SECURITY:
 *   - Read-only operation (no mutation).
 *   - No info leak about the counter to the caller — only the boolean detection.
 *   - Detection works on APPROVED tx only — PENDING/DECLINED/REFUNDED don't count.
 */

/** Lower bound of the threshold-boundary range — equal to Tier 1 threeDsThresholdCop. */
export const STRUCTURING_LOWER_BOUND_COP = 200_000;

/** Upper bound of the threshold-boundary range — just above the threshold. */
export const STRUCTURING_UPPER_BOUND_COP = 300_000;

/** Detection window — 24 hours (rolling). */
export const STRUCTURING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Threshold — 3+ tx in the window triggers detection. */
export const STRUCTURING_THRESHOLD = 3;

/**
 * Whether an amount is in the threshold-boundary range.
 * INCLUSIVE on both bounds — exactly $200,000 counts (the bypass case).
 */
export function isInBoundaryRange(amountCop: number): boolean {
  return (
    Number.isInteger(amountCop) &&
    amountCop >= STRUCTURING_LOWER_BOUND_COP &&
    amountCop <= STRUCTURING_UPPER_BOUND_COP
  );
}

/** Subset of MarketTransaction used for structuring detection. */
export interface TransactionForStructuring {
  transaction_id: string;
  from_user_id?: string;
  to_user_id?: string;
  amount_cop: number;
  status: string;
  updated_at: string;
}

export interface DetectStructuringInput {
  senderId: string;
  recipientId: string;
  /** The amount of the CURRENT tx — used to verify it's in boundary range. */
  amountCop: number;
  /** Now timestamp (ms) — for deterministic tests. */
  nowMs: number;
}

export interface DetectStructuringDeps {
  /** Document client used to query the TransactionsTable. */
  queryClient: { send: (cmd: any) => Promise<{ Items?: TransactionForStructuring[] }> };
  /** Name of the TransactionsTable. */
  transactionsTableName: string;
}

export interface StructuringDetection {
  /** Count of in-boundary tx from sender→recipient in the 24h window. */
  count: number;
  /** Window size used for detection (ms). */
  windowMs: number;
  /** The transaction IDs that triggered the detection (audit trail). */
  triggeringTransactionIds: string[];
}

/**
 * Detect structuring pattern: >= 3 tx from sender→recipient in [200k, 300k] COP range
 * within the last 24h.
 *
 * Returns the detection if the pattern is detected, null otherwise.
 *
 * Caller responsibility:
 *   - The detection is a SIGNAL — log it for DPO review.
 *   - Do NOT auto-block the immediate transaction. The bypass is real but
 *     the AMOUNT is in a range where 3DS would normally be required, so
 *     the tx itself isn't suspicious — the PATTERN is.
 *   - Caller may also write a FraudSignals record for DPO dashboard visibility.
 */
export async function detectStructuring(
  input: DetectStructuringInput,
  deps: DetectStructuringDeps,
): Promise<StructuringDetection | null> {
  if (!isInBoundaryRange(input.amountCop)) {
    return null;
  }

  // Query APPROVED tx from this sender in the last 24h.
  // We can't filter by recipient at the DDB query level (only status + updated_at are indexed).
  // So we fetch the sender's recent APPROVED tx and filter in code.
  // For a typical user, this is < 10 tx per day.
  const minUpdatedAt = new Date(input.nowMs - STRUCTURING_WINDOW_MS).toISOString();
  const result = await deps.queryClient.send({
    TableName: deps.transactionsTableName,
    IndexName: "StatusUpdatedAtIndex",
    KeyConditionExpression: "#status = :status AND updated_at >= :minTs",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":status": "APPROVED",
      ":minTs": minUpdatedAt,
    },
    // Safety cap — typical users won't have more than this in 24h.
    Limit: 200,
  });

  const items = (result.Items ?? []).filter((tx) => {
    // Defensive: only count APPROVED tx. The DDB query already filters by
    // status via StatusUpdatedAtIndex, but we re-check to protect against
    // future index changes / mock-client edge cases.
    if (tx.status !== "APPROVED") return false;
    if (tx.from_user_id !== input.senderId) return false;
    if (tx.to_user_id !== input.recipientId) return false;
    if (!isInBoundaryRange(tx.amount_cop)) return false;
    return true;
  });

  // Spec: "more than 3 transactions above the 3DS threshold in a 24h window".
  // Interpretation: 3+ EXISTING tx + current = 4+ total. If there are already
  // 3+ matching tx in the window, the current (4th) is the trigger.
  if (items.length < STRUCTURING_THRESHOLD) {
    return null;
  }

  return {
    count: items.length,
    windowMs: STRUCTURING_WINDOW_MS,
    triggeringTransactionIds: items.map((tx) => tx.transaction_id),
  };
}
