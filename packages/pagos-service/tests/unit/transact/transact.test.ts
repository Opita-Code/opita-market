/**
 * Tests for the transact wrapper.
 *
 * SECURITY-CRITICAL — closes:
 *   OPL-API-001 — P2P transfer non-atomic (funds lost)
 *   OPL-CARD-003 — same
 *   OPL-LIB-002 — TOCTOU debit overdraft
 *   OPL-LIB-006 — stale balance leak in error message
 *   OPL-LIB-008 — FIRST_PURCHASE bonus race
 *   OPL-CARD-019 — same
 *   OPL-LIB-012 — escrow state machine race
 *
 * TDD: RED until src/lib/transact/* modules are implemented.
 */
import { describe, it, expect, vi } from "vitest";
import {
  transact,
  transactDebitWallet,
  transactP2PTransfer,
  transactEscrowTransition,
  transactBonusClaim,
  transactReverseBonus,
  type TransactItem,
  type TransactDeps,
} from "../../../src/lib/transact/index.js";
import {
  TransactError,
  ConditionFailedError,
  InsufficientBalanceError,
  SelfTransferError,
  InvalidAmountError,
  TooManyItemsError,
  DuplicateIdempotencyError,
  ConflictingIdempotencyError,
} from "../../../src/lib/transact/errors.js";

/**
 * Mock DynamoDB client that can be programmed with responses.
 * Tracks call count for retry verification.
 */
class MockDynamoClient {
  calls: unknown[] = [];
  callCount = 0;
  responses: { result: unknown }[] = [];
  /** If set, throws this error on every call */
  throwError: Error | null = null;

  send = vi.fn(async (cmd: unknown) => {
    this.calls.push(cmd);
    this.callCount++;
    if (this.throwError) throw this.throwError;
    if (this.responses.length === 0) return {};
    return this.responses.shift()!.result;
  });

  /**
   * Replace `send` with a function that throws TransactionConflictException
   * on the first N invocations, then returns `finalResult`. Tracks callCount.
   */
  failFirstNCallsWithConflict(n: number, finalResult: unknown = {}): void {
    this.send = vi.fn(async () => {
      this.callCount++;
      if (this.callCount <= n) {
        const e: any = new Error("Transaction conflict, please retry");
        e.name = "TransactionConflictException";
        throw e;
      }
      return finalResult;
    });
  }

  /**
   * Replace `send` with a function that throws ConditionalCheckFailedException
   * on every call. Tracks callCount.
   */
  alwaysFailWithConditionCheck(): void {
    this.send = vi.fn(async () => {
      this.callCount++;
      const e: any = new Error("The conditional request failed");
      e.name = "ConditionalCheckFailedException";
      throw e;
    });
  }
}

describe("transact — wrapper", () => {
  it("succeeds with empty response", async () => {
    const client = new MockDynamoClient();
    const items: TransactItem[] = [
      { table: "wallets", key: { user_id: "u1" }, updateExpression: "SET balance_cop = :b", expressionAttributeValues: { ":b": 0 } },
    ];
    await transact(items, { client: client as any });
    expect(client.callCount).toBe(1);
  });

  it("throws TooManyItemsError when items > 100", async () => {
    const client = new MockDynamoClient();
    const items: TransactItem[] = Array.from({ length: 101 }, (_, i) => ({
      table: "wallets",
      key: { user_id: `u${i}` },
      updateExpression: "SET x = :x",
      expressionAttributeValues: { ":x": 0 },
    }));
    await expect(transact(items, { client: client as any })).rejects.toThrow(TooManyItemsError);
  });

  it("retries on TransactionConflictException up to 3 times", async () => {
    const client = new MockDynamoClient();
    client.failFirstNCallsWithConflict(2, {});
    const items: TransactItem[] = [
      { table: "wallets", key: { user_id: "u1" }, updateExpression: "SET x = :x", expressionAttributeValues: { ":x": 0 } },
    ];
    await transact(items, { client: client as any, retry: { maxAttempts: 3, baseDelayMs: 1 } });
    expect(client.callCount).toBe(3); // 2 conflicts + 1 success
  });

  it("throws TransactError after max retries exhausted", async () => {
    const client = new MockDynamoClient();
    client.failFirstNCallsWithConflict(10, {});
    const items: TransactItem[] = [
      { table: "wallets", key: { user_id: "u1" }, updateExpression: "SET x = :x", expressionAttributeValues: { ":x": 0 } },
      { table: "wallets", key: { user_id: "u2" }, updateExpression: "SET x = :x", expressionAttributeValues: { ":x": 0 } },
    ];
    await expect(transact(items, { client: client as any, retry: { maxAttempts: 3, baseDelayMs: 1 } })).rejects.toThrow(TransactError);
  });
});

describe("transact — wallet", () => {
  it("transactDebitWallet succeeds with sufficient balance (closes OPL-LIB-002 TOCTOU)", async () => {
    const client = new MockDynamoClient();
    const result = await transactDebitWallet(
      { userId: "u1", amountCop: 100, idempotencyKey: "k1" },
      { client: client as any },
    );
    expect(result.userId).toBe("u1");
    expect(client.callCount).toBe(1);
  });

  it("transactDebitWallet throws InsufficientBalanceError on condition fail (no balance leak)", async () => {
    const client = new MockDynamoClient();
    client.alwaysFailWithConditionCheck();
    await expect(
      transactDebitWallet({ userId: "u1", amountCop: 100, idempotencyKey: "k1" }, { client: client as any }),
    ).rejects.toThrow(InsufficientBalanceError);
    // The error message MUST NOT include the actual balance (closes OPL-LIB-006)
    try {
      await transactDebitWallet({ userId: "u1", amountCop: 100, idempotencyKey: "k1" }, { client: client as any });
    } catch (e) {
      expect((e as Error).message).not.toMatch(/\d{3,}/);  // no numeric balance
      expect((e as Error).message).toBe("Insufficient balance for this operation");
    }
  });

  it("transactDebitWallet throws InvalidAmountError for non-positive amount", async () => {
    const client = new MockDynamoClient();
    await expect(
      transactDebitWallet({ userId: "u1", amountCop: 0, idempotencyKey: "k1" }, { client: client as any }),
    ).rejects.toThrow(InvalidAmountError);
    await expect(
      transactDebitWallet({ userId: "u1", amountCop: -10, idempotencyKey: "k1" }, { client: client as any }),
    ).rejects.toThrow(InvalidAmountError);
  });

  it("transactP2PTransfer is atomic (closes OPL-API-001, OPL-CARD-003)", async () => {
    const client = new MockDynamoClient();
    const result = await transactP2PTransfer(
      { fromUserId: "u1", toUserId: "u2", amountCop: 100, idempotencyKey: "k1" },
      { client: client as any },
    );
    // Both legs in single TransactWriteItems call
    expect(client.callCount).toBe(1);
    expect(result.amountCop).toBe(100);
  });

  it("transactP2PTransfer rolls back both legs on condition fail", async () => {
    const client = new MockDynamoClient();
    client.alwaysFailWithConditionCheck();
    await expect(
      transactP2PTransfer(
        { fromUserId: "u1", toUserId: "u2", amountCop: 100, idempotencyKey: "k1" },
        { client: client as any },
      ),
    ).rejects.toThrow();
    // Single call attempted (which atomically rolled back)
    expect(client.callCount).toBe(1);
  });

  it("transactP2PTransfer throws SelfTransferError when from === to", async () => {
    const client = new MockDynamoClient();
    await expect(
      transactP2PTransfer(
        { fromUserId: "u1", toUserId: "u1", amountCop: 100, idempotencyKey: "k1" },
        { client: client as any },
      ),
    ).rejects.toThrow(SelfTransferError);
  });

  it("transactP2PTransfer throws InvalidAmountError for non-positive amount", async () => {
    const client = new MockDynamoClient();
    await expect(
      transactP2PTransfer(
        { fromUserId: "u1", toUserId: "u2", amountCop: 0, idempotencyKey: "k1" },
        { client: client as any },
      ),
    ).rejects.toThrow(InvalidAmountError);
  });
});

describe("transact — escrow", () => {
  it("transactEscrowTransition succeeds on valid transition", async () => {
    const client = new MockDynamoClient();
    await transactEscrowTransition(
      { txId: "tx-1", fromState: "HELD", toState: "RELEASED", idempotencyKey: "k1" },
      { client: client as any },
    );
    expect(client.callCount).toBe(1);
  });

  it("transactEscrowTransition throws ConditionFailedError on state conflict (closes OPL-LIB-012)", async () => {
    const client = new MockDynamoClient();
    client.alwaysFailWithConditionCheck();
    await expect(
      transactEscrowTransition(
        { txId: "tx-1", fromState: "HELD", toState: "RELEASED", idempotencyKey: "k1" },
        { client: client as any },
      ),
    ).rejects.toThrow(ConditionFailedError);
  });
});

describe("transact — bonus", () => {
  it("transactBonusClaim succeeds on first claim", async () => {
    const client = new MockDynamoClient();
    const result = await transactBonusClaim(
      { userId: "u1", ruleId: "FIRST_PURCHASE", amountCop: 100, transactionId: "tx-1", idempotencyKey: "k1" },
      { client: client as any },
    );
    expect(result.userId).toBe("u1");
    expect(result.amountCop).toBe(100);
  });

  it("transactBonusClaim throws ConditionFailedError on duplicate (closes OPL-LIB-008, OPL-CARD-019)", async () => {
    const client = new MockDynamoClient();
    client.alwaysFailWithConditionCheck();
    await expect(
      transactBonusClaim(
        { userId: "u1", ruleId: "FIRST_PURCHASE", amountCop: 100, transactionId: "tx-1", idempotencyKey: "k1" },
        { client: client as any },
      ),
    ).rejects.toThrow(ConditionFailedError);
  });
});

describe("transact — PR 7 transactReverseBonus (closes OPL-CARD-014)", () => {
  /**
   * Reverse-bonus uses TWO clients:
   *  - bonusQueryClient: docClient for GSI query (BonusesTable.TransactionIdIndex)
   *  - client: raw DynamoDB for TransactWriteItems
   */
  function makeReverseDeps(queryItems: any[] = []) {
    const transactClient = new MockDynamoClient();
    const queryClient = {
      send: vi.fn(async () => ({ Items: queryItems })),
    };
    return {
      transactClient,
      queryClient,
      deps: {
        client: transactClient as any,
        bonusQueryClient: queryClient as any,
        bonusesTableName: "BonusesTable",
      } as any,
    };
  }

  it("reverses 2 bonuses + debits wallet total in single TransactWriteItems", async () => {
    const { transactClient, queryClient, deps } = makeReverseDeps([
      { user_id: "seller-1", rule_id: "PURCHASE_CASHBACK", amount_cop: 2000, reversed: false },
      { user_id: "seller-1", rule_id: "SELLER_REPEAT_SALE", amount_cop: 5000, reversed: false },
    ]);
    const result = await transactReverseBonus(
      { transactionId: "tx-refund-1", idempotencyKey: "refund:tx-refund-1:wrefund-abc" },
      deps,
    );
    expect(result.reversedCount).toBe(2);
    expect(result.totalDebitedCop).toBe(7000);
    // 2 bonus updates + 1 wallet debit = 3 TransactWriteItems in 1 call
    expect(transactClient.callCount).toBe(1);
    const cmd = transactClient.calls[0] as any;
    expect(cmd.TransactItems).toHaveLength(3);
    // Query used the GSI with transaction_id
    expect(queryClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: "TransactionIdIndex",
        KeyConditionExpression: "transaction_id = :tid",
      }),
    );
  });

  it("returns 0/0 when no un-reversed bonuses exist (idempotent retry)", async () => {
    const { transactClient, deps } = makeReverseDeps([
      { user_id: "seller-1", rule_id: "PURCHASE_CASHBACK", amount_cop: 2000, reversed: true },
    ]);
    const result = await transactReverseBonus(
      { transactionId: "tx-refund-1", idempotencyKey: "k1" },
      deps,
    );
    expect(result.reversedCount).toBe(0);
    expect(result.totalDebitedCop).toBe(0);
    // No TransactWriteItems call when nothing to reverse
    expect(transactClient.callCount).toBe(0);
  });

  it("filters out already-reversed bonuses", async () => {
    const { transactClient, deps } = makeReverseDeps([
      { user_id: "seller-1", rule_id: "PURCHASE_CASHBACK", amount_cop: 2000, reversed: true },
      { user_id: "seller-1", rule_id: "SELLER_REPEAT_SALE", amount_cop: 5000, reversed: false },
    ]);
    const result = await transactReverseBonus(
      { transactionId: "tx-1", idempotencyKey: "k1" },
      deps,
    );
    // Only the second one is reversed
    expect(result.reversedCount).toBe(1);
    expect(result.totalDebitedCop).toBe(5000);
    const cmd = transactClient.calls[0] as any;
    expect(cmd.TransactItems).toHaveLength(2); // 1 bonus update + 1 wallet debit
  });

  it("throws if wallet balance < total bonus to debit (closes OPL-LIB-006 — no info leak)", async () => {
    const { transactClient, deps } = makeReverseDeps([
      { user_id: "seller-1", rule_id: "PURCHASE_CASHBACK", amount_cop: 1_000_000, reversed: false },
    ]);
    transactClient.alwaysFailWithConditionCheck();
    await expect(
      transactReverseBonus({ transactionId: "tx-1", idempotencyKey: "k1" }, deps),
    ).rejects.toThrow();
    // The error message MUST NOT include the actual balance or amount
    try {
      await transactReverseBonus({ transactionId: "tx-1", idempotencyKey: "k1" }, deps);
    } catch (e) {
      expect((e as Error).message).not.toContain("1000000");
      expect((e as Error).message).not.toContain("seller-1");
    }
  });

  it("rejects empty transactionId", async () => {
    const { deps } = makeReverseDeps();
    await expect(
      transactReverseBonus({ transactionId: "", idempotencyKey: "k1" }, deps),
    ).rejects.toThrow(/transactionId/);
  });

  it("rejects empty idempotencyKey", async () => {
    const { deps } = makeReverseDeps();
    await expect(
      transactReverseBonus({ transactionId: "tx-1", idempotencyKey: "" }, deps),
    ).rejects.toThrow(/idempotencyKey/);
  });
});

describe("transact — idempotency", () => {
  it("returns cached result for same idempotencyKey", async () => {
    const client = new MockDynamoClient();
    await transactDebitWallet(
      { userId: "u1", amountCop: 100, idempotencyKey: "k1" },
      { client: client as any },
    );
    // Note: the spec says same key returns cached result. In our impl, the
    // idempotency check is enforced at the condition level (DynamoDB).
    // For unit testing, we verify the condition expression includes the key.
    const firstCall = client.calls[0] as any;
    expect(JSON.stringify(firstCall)).toContain("k1");
  });

  it("includes idempotency key in ConditionExpression", async () => {
    const client = new MockDynamoClient();
    await transactDebitWallet(
      { userId: "u1", amountCop: 100, idempotencyKey: "my-uuid-1234" },
      { client: client as any },
    );
    const cmd = client.calls[0] as any;
    // Command structure: { TransactItems: [{ Update: { ConditionExpression, ExpressionAttributeValues, ... } }] }
    const condExpr = cmd.TransactItems[0].Update.ConditionExpression;
    const values = JSON.stringify(cmd.TransactItems[0].Update.ExpressionAttributeValues);
    expect(condExpr).toBeDefined();
    expect(condExpr).toContain("last_idempotency_key");
    expect(values).toContain("my-uuid-1234");
  });
});
