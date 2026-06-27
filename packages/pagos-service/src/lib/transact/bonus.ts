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
  };
}
