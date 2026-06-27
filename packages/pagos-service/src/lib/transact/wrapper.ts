/**
 * Transact wrapper — atomic multi-item operations.
 *
 * R1 — Single-call atomicity via DynamoDB TransactWriteItems.
 * R2 — Retry with exponential backoff on TransactionConflictException.
 * R4 — Idempotency via ConditionExpression on each item.
 *
 * This module does NOT depend on the AWS SDK directly — it accepts a client
 * with a `send(command)` method, which keeps it testable with a mock.
 */

import {
  ConditionFailedError,
  InvalidAmountError,
  TooManyItemsError,
  TransactError,
} from "./errors.js";
import { DEFAULT_RETRY, type TransactDeps, type TransactItem } from "./types.js";

const MAX_ITEMS = 100;
const TRANSACTION_CONFLICT = "TransactionConflictException";
const CONDITIONAL_CHECK_FAILED = "ConditionalCheckFailedException";

function isTransactionConflict(err: unknown): boolean {
  return (err as { name?: string })?.name === TRANSACTION_CONFLICT;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === CONDITIONAL_CHECK_FAILED;
}

function buildTransactItem(item: TransactItem): unknown {
  const expr: Record<string, unknown> = {
    TableName: item.table,
    Key: item.key,
    UpdateExpression: item.updateExpression,
    ExpressionAttributeValues: item.expressionAttributeValues,
  };
  if (item.conditionExpression) {
    expr.ConditionExpression = item.conditionExpression;
  }
  if (item.expressionAttributeNames) {
    expr.ExpressionAttributeNames = item.expressionAttributeNames;
  }
  return { Update: expr };
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute multiple DynamoDB operations atomically.
 *
 * Throws:
 * - TooManyItemsError if items > 100
 * - ConditionFailedError on any conditional check failure (no retry)
 * - TransactError after max retries on TransactionConflictException
 */
export async function transact(
  items: TransactItem[],
  deps: TransactDeps,
): Promise<void> {
  if (items.length === 0) {
    throw new TransactError("No items to transact");
  }
  if (items.length > MAX_ITEMS) {
    throw new TooManyItemsError();
  }

  const retry = deps.retry ?? DEFAULT_RETRY;
  const sleep = deps.sleep ?? defaultSleep;
  const transactItems = items.map(buildTransactItem);

  let lastError: unknown;
  for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
    try {
      await deps.client.send({ TransactItems: transactItems });
      return;
    } catch (err) {
      lastError = err;
      if (isConditionalCheckFailed(err)) {
        throw new ConditionFailedError("Condition check failed");
      }
      if (!isTransactionConflict(err)) {
        throw new TransactError(
          `Transact failed: ${(err as Error).message ?? "unknown"}`,
        );
      }
      // Transaction conflict → retry with exponential backoff
      if (attempt < retry.maxAttempts - 1) {
        await sleep(retry.baseDelayMs * Math.pow(5, attempt));
      }
    }
  }
  throw new TransactError(
    `Transact exhausted ${retry.maxAttempts} retries on conflict`,
  );
}

export { isPositiveInteger, InvalidAmountError };
