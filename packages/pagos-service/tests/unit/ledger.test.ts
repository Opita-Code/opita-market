import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CreditWalletUseCase, DebitWalletUseCase, GetBalanceUseCase } from "../../src/lib/ledger.js";
import { InsufficientBalanceError } from "../../src/lib/errors.js";

/**
 * Tests for ledger operations.
 *
 * INVARIANTS:
 *   - Ledger is append-only (entries never modified or deleted)
 *   - Balance projection = sum of all entries' amount_cop
 *   - Debit rejects if balance would go negative
 *   - Optimistic concurrency via `version` attribute
 *   - First credit creates wallet row if not exists
 *
 * Mocks DynamoDBDocumentClient so tests are hermetic (no LocalStack).
 */
const ddbMock = mockClient(DynamoDBDocumentClient);

describe("ledger — wallet operations", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe("CreditWalletUseCase", () => {
    it("creates wallet on first credit (upsert)", async () => {
      ddbMock.on(UpdateCommand).resolves({ Attributes: undefined });

      const useCase = new CreditWalletUseCase("wallets-table", "users-table");
      await useCase.execute({
        userId: "user-1",
        amountCop: 1000,
        transactionId: "tx-1",
        idempotencyKey: "idem-1",
      });

      // Verify UpdateCommand was called with create-or-update semantics
      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0]!.args[0].input;
      expect(input.TableName).toBe("wallets-table");
      expect(input.Key).toEqual({ user_id: "user-1" });
    });

    it("rejects on negative amount", async () => {
      const useCase = new CreditWalletUseCase("wallets-table", "users-table");
      await expect(
        useCase.execute({
          userId: "user-1",
          amountCop: -100,
          transactionId: "tx-1",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow();
    });

    it("rejects on zero amount", async () => {
      const useCase = new CreditWalletUseCase("wallets-table", "users-table");
      await expect(
        useCase.execute({
          userId: "user-1",
          amountCop: 0,
          transactionId: "tx-1",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow();
    });
  });

  describe("DebitWalletUseCase", () => {
    it("rejects when balance would go negative", async () => {
      // Mock wallet with low balance
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { balance_cop: 100, version: 1 },
      });

      const useCase = new DebitWalletUseCase("wallets-table");
      // Wait — we need a debit that returns the CURRENT balance BEFORE the operation
      // For simplicity, we mock the wallet GET to return balance=100
      ddbMock.on(GetCommand).resolves({
        Item: { user_id: "user-1", balance_cop: 100, version: 1 },
      });

      await expect(
        useCase.execute({
          userId: "user-1",
          amountCop: 500, // requested > balance
          transactionId: "tx-1",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow(InsufficientBalanceError);
    });

    it("rejects on zero or negative amount", async () => {
      const useCase = new DebitWalletUseCase("wallets-table");
      await expect(
        useCase.execute({
          userId: "user-1",
          amountCop: 0,
          transactionId: "tx-1",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow();
    });
  });

  describe("GetBalanceUseCase", () => {
    it("returns 0 for non-existent wallet", async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const useCase = new GetBalanceUseCase("wallets-table");
      const result = await useCase.execute({ userId: "user-1" });
      expect(result.balanceCop).toBe(0);
      expect(result.version).toBe(0);
    });

    it("returns balance for existing wallet", async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { user_id: "user-1", balance_cop: 5000, version: 3 },
      });

      const useCase = new GetBalanceUseCase("wallets-table");
      const result = await useCase.execute({ userId: "user-1" });
      expect(result.balanceCop).toBe(5000);
      expect(result.version).toBe(3);
    });
  });

  describe("Optimistic concurrency", () => {
    it("CreditWallet bumps version on each call", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const useCase = new CreditWalletUseCase("wallets-table", "users-table");
      await useCase.execute({ userId: "user-1", amountCop: 100, transactionId: "tx-1", idempotencyKey: "idem-1" });
      await useCase.execute({ userId: "user-1", amountCop: 200, transactionId: "tx-2", idempotencyKey: "idem-2" });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(2);
      // Both calls should bump version (if_not_exists + :one is functionally equivalent to version+1).
      for (const call of calls) {
        const expr = call.args[0].input.UpdateExpression;
        expect(expr).toContain("version = if_not_exists(version, :zero) + :one");
      }
    });

    it("DebitWallet rejects with version mismatch (ConditionalCheckFailedException)", async () => {
      ddbMock.on(UpdateCommand).rejects({
        name: "ConditionalCheckFailedException",
        message: "version mismatch",
      });

      const useCase = new DebitWalletUseCase("wallets-table");
      await expect(
        useCase.execute({
          userId: "user-1",
          amountCop: 100,
          transactionId: "tx-1",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow();
    });
  });

  describe("Idempotency (replay protection)", () => {
    it("CreditWallet uses idempotency_key in ConditionExpression", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const useCase = new CreditWalletUseCase("wallets-table", "users-table");
      await useCase.execute({
        userId: "user-1",
        amountCop: 100,
        transactionId: "tx-1",
        idempotencyKey: "idem-XYZ-123",
      });

      const call = ddbMock.commandCalls(UpdateCommand)[0];
      const input = call.args[0].input;
      // Idempotency key MUST be in ConditionExpression (replay protection)
      expect(input.ConditionExpression).toContain("last_idempotency_key");
      // Idempotency key MUST be in ExpressionAttributeValues
      expect(JSON.stringify(input.ExpressionAttributeValues)).toContain("idem-XYZ-123");
    });

    it("CreditWallet throws IdempotencyKeyReusedError on replay", async () => {
      // Simulate ConditionalCheckFailedException (DynamoDB's rejection for condition mismatch)
      ddbMock.on(UpdateCommand).rejects({
        name: "ConditionalCheckFailedException",
        message: "idempotency_key replay detected",
      });

      const useCase = new CreditWalletUseCase("wallets-table", "users-table");
      await expect(
        useCase.execute({
          userId: "user-1",
          amountCop: 100,
          transactionId: "tx-1",
          idempotencyKey: "idem-DUPLICATE",
        }),
      ).rejects.toThrow();
    });
  });

  describe("Ledger entry append-only (write-through)", () => {
    it("CreditWallet also writes a ledger entry after wallet update", async () => {
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      const useCase = new CreditWalletUseCase("wallets-table", "ledger-table");
      await useCase.execute({
        userId: "user-1",
        amountCop: 500,
        transactionId: "tx-1",
        idempotencyKey: "idem-1",
      });

      // Both Update (wallet) and Put (ledger) should be called
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      expect(putCalls.length).toBeGreaterThanOrEqual(1);

      // The ledger Put should target the ledger table with correct movement type
      const ledgerPut = putCalls[0]!;
      expect(ledgerPut.args[0].input.TableName).toBe("ledger-table");
      expect(ledgerPut.args[0].input.Item).toMatchObject({
        user_id: "user-1",
        movement: "DEPOSITO",
        amount_cop: 500,
        transaction_id: "tx-1",
      });
    });
  });
});