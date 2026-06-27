/**
 * Atomic bonus claim.
 *
 * R-bonus-1 — First-purchase bonuses MUST be atomic (closes OPL-LIB-008, OPL-CARD-019).
 * The ConditionExpression ensures only one concurrent claim for the same
 * (user_id, rule_id, transaction_id) can succeed.
 *
 * For percentage rules, the caller computes the amount and passes it
 * (bonus engine logic stays in src/lib/bonus-rules.ts).
 */

import { transact, type TransactDeps, type TransactItem } from "./index.js";

export interface BonusClaimInput {
  userId: string;
  ruleId: string;
  amountCop: number;
  transactionId: string;
  idempotencyKey: string;
}

export interface BonusClaimResult {
  userId: string;
  ruleId: string;
  amountCop: number;
  bonusId: string;
  newBalanceCop: number;
}

/**
 * Atomically apply a bonus to a user's wallet.
 *
 * - ConditionExpression: attribute_not_exists(claimed_for) — ensures
 *   (user_id, rule_id, transaction_id) hasn't been claimed before
 * - Writes bonus record + credits wallet in single TransactWriteItems
 * - Throws ConditionFailedError on duplicate claim
 */
export async function transactBonusClaim(
  input: BonusClaimInput,
  deps: TransactDeps,
): Promise<BonusClaimResult> {
  const now = new Date().toISOString();
  const bonusId = `${input.userId}:${input.ruleId}:${input.transactionId}`;
  const items: TransactItem[] = [
    {
      table: "bonuses",
      key: { user_id: input.userId, rule_id: input.ruleId, transaction_id: input.transactionId },
      updateExpression:
        "SET bonus_id = :bonusId, " +
        "amount_cop = :amt, " +
        "claimed_at = :now, " +
        "idempotency_key = :idem",
      conditionExpression: "attribute_not_exists(claimed_at)",
      expressionAttributeValues: {
        ":bonusId": bonusId,
        ":amt": input.amountCop,
        ":now": now,
        ":idem": input.idempotencyKey,
      },
    },
    {
      table: "wallets",
      key: { user_id: input.userId },
      updateExpression:
        "SET balance_cop = if_not_exists(balance_cop, :zero) + :amt, " +
        "version = if_not_exists(version, :zero) + :one, " +
        "updated_at = :now",
      expressionAttributeValues: {
        ":amt": input.amountCop,
        ":zero": 0,
        ":one": 1,
        ":now": now,
      },
    },
  ];
  await transact(items, deps);
  return {
    userId: input.userId,
    ruleId: input.ruleId,
    amountCop: input.amountCop,
    bonusId,
    newBalanceCop: 0, // populated by caller from ReturnValues=ALL_NEW if needed
  }
}

// ─── PR 7 — Bonus reversal (closes OPL-CARD-014) ──────────────────────────────

/**
 * Input for reversing bonuses associated with a refunded transaction.
 */
export interface ReverseBonusInput {
  /** The transaction whose bonuses should be reversed. */
  transactionId: string;
  /**
   * Idempotency key for this reversal. Re-running with the same key is a no-op.
   * Convention: `refund:${transactionId}:${wompiRefundId}` or `refund:${txId}:${ts}`
   */
  idempotencyKey: string;
}

/**
 * Result of a bonus reversal operation.
 */
export interface ReverseBonusResult {
  transactionId: string;
  /** Number of bonus records marked as reversed. */
  reversedCount: number;
  /** Total COP debited from the seller's wallet. */
  totalDebitedCop: number;
}

/**
 * Dependency for the bonus reversal implementation.
 * Provides a way to look up bonuses by transaction_id (via TransactionIdIndex GSI).
 */
export interface ReverseBonusDeps extends TransactDeps {
  /** Document client used to query the BonusesTable TransactionIdIndex GSI. */
  bonusQueryClient: {
    send: (cmd: any) => Promise<{ Items?: any[] }>;
  };
  /** Name of the BonusesTable. */
  bonusesTableName: string;
}

/**
 * Reverse all bonuses associated with a transaction (idempotent).
 *
 * Flow:
 *   1. Query BonusesTable.TransactionIdIndex for all bonus records with this tx_id
 *      where reversed=false.
 *   2. For each bonus, mark reversed=true via TransactWriteItems.
 *   3. Debit total amount from the bonus recipient's wallet (single TransactWriteItems).
 *
 * Idempotency:
 *   - Uses transactionId as the lookup key + idempotencyKey on each write
 *   - Bonus update: ConditionExpression `attribute_not_exists(reversed_at) OR reversed_at = :now`
 *   - Re-running with same idempotencyKey skips already-reversed records.
 *
 * SECURITY:
 *   - No info leak about the seller's balance on failure.
 *   - If seller's balance < total bonus to debit, throws InsufficientBalanceError
 *     (transaction stays APPROVED, caller must handle).
 *
 * NOTE: This is a higher-level operation than the transact/* helpers.
 * It's wired into AppContext.transactReverseBonus so the webhook + refund
 * routes share the same implementation.
 */
export async function transactReverseBonus(
  input: ReverseBonusInput,
  deps: ReverseBonusDeps,
): Promise<ReverseBonusResult> {
  if (!input.transactionId) {
    throw new Error("transactionId is required");
  }
  if (!input.idempotencyKey) {
    throw new Error("idempotencyKey is required");
  }

  // 1. Query all bonuses for this transaction via GSI.
  const queryResult = await deps.bonusQueryClient.send({
    TableName: deps.bonusesTableName,
    IndexName: "TransactionIdIndex",
    KeyConditionExpression: "transaction_id = :tid",
    ExpressionAttributeValues: { ":tid": input.transactionId },
  });
  const items = queryResult.Items ?? [];

  // 2. Filter to un-reversed bonuses only.
  const unReversed = items.filter((b: any) => b.reversed !== true);

  if (unReversed.length === 0) {
    return {
      transactionId: input.transactionId,
      reversedCount: 0,
      totalDebitedCop: 0,
    };
  }

  // 3. Build TransactWriteItems: mark each bonus as reversed + debit wallet.
  const now = new Date().toISOString();
  const totalDebitCop = unReversed.reduce((sum: number, b: any) => sum + (b.amount_cop ?? 0), 0);
  const sellerUserId = unReversed[0].user_id;

  const transactItems: TransactItem[] = unReversed.map((b: any) => ({
    table: "bonuses",
    key: { user_id: b.user_id, rule_id: b.rule_id },
    updateExpression:
      "SET reversed = :true, " +
      "reversed_at = :now, " +
      "reversal_idempotency_key = :idem, " +
      "updated_at = :now",
    conditionExpression: "attribute_not_exists(reversed_at) OR reversed_at = :now",
    expressionAttributeValues: {
      ":true": true,
      ":now": now,
      ":idem": input.idempotencyKey,
    },
  }));

  // Single wallet debit (sum of all reversed bonuses) — only if > 0.
  if (totalDebitCop > 0) {
    transactItems.push({
      table: "wallets",
      key: { user_id: sellerUserId },
      updateExpression:
        "SET balance_cop = balance_cop - :amt, " +
        "version = if_not_exists(version, :zero) + :one, " +
        "updated_at = :now, " +
        "last_idempotency_key = :idem",
      // SECURITY: require sufficient balance. If seller already spent the bonus,
      // the reversal fails atomically (no partial state). Caller must handle.
      conditionExpression: "balance_cop >= :amt",
      expressionAttributeValues: {
        ":amt": totalDebitCop,
        ":zero": 0,
        ":one": 1,
        ":now": now,
        ":idem": input.idempotencyKey,
      },
    });
  }

  await transact(transactItems, deps);

  return {
    transactionId: input.transactionId,
    reversedCount: unReversed.length,
    totalDebitedCop: totalDebitCop,
  };
}
