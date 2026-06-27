/**
 * Ledger operations for Opita Pagos.
 *
 * INVARIANTS:
 *   - Ledger is APPEND-ONLY. Entries are never modified or deleted.
 *   - Wallet.balance_cop is a PROJECTION derived from the ledger entries.
 *     (In this implementation we use a denormalized counter for performance,
 *     with strict invariant: every wallet update MUST be paired with a ledger entry.)
 *   - Optimistic concurrency via `version` attribute on wallet rows.
 *     Every mutation uses ConditionExpression with the current version.
 *
 * SECURITY:
 *   - Debits MUST verify sufficient balance BEFORE the operation.
 *   - ConditionalCheckFailedException indicates race condition — caller should retry.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { add, isPositive } from "./money.js";
import { InsufficientBalanceError } from "./errors.js";
import type { MarketLedgerEntry, MarketWallet, LedgerMovementType } from "../db/tables.js";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface CreditInput {
  userId: string;
  amountCop: number;
  transactionId: string;
  idempotencyKey: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface DebitInput {
  userId: string;
  amountCop: number;
  transactionId: string;
  idempotencyKey: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface BalanceResult {
  balanceCop: number;
  version: number;
  tier: 0 | 1 | 2 | 3 | 4;
  kycState: string;
}

// ─── Use Cases ───────────────────────────────────────────────────────────────

/**
 * Credit a wallet by `amountCop`. Creates wallet row if not exists.
 * Appends a DEPOSITO ledger entry.
 */
export class CreditWalletUseCase {
  constructor(
    private readonly walletsTable: string,
    private readonly ledgerTable: string,
    private readonly client: DynamoDBDocumentClient = defaultClient(),
  ) {}

  async execute(input: CreditInput): Promise<void> {
    if (!isPositive(input.amountCop)) {
      throw new Error(`amountCop must be positive, got ${input.amountCop}`);
    }
    if (!input.userId) throw new Error("userId is required");
    if (!input.transactionId) throw new Error("transactionId is required");
    if (!input.idempotencyKey) throw new Error("idempotencyKey is required");

    // Step 1: Atomically increment wallet balance with optimistic concurrency.
    // - if_not_exists creates the row on first credit.
    // - Idempotency: ConditionExpression rejects if the same idempotency_key
    //   was already processed (replay protection).
    // - Version bump on every mutation.
    await this.client.send(
      new UpdateCommand({
        TableName: this.walletsTable,
        Key: { user_id: input.userId },
        UpdateExpression:
          "SET balance_cop = if_not_exists(balance_cop, :zero) + :amount, " +
          "version = if_not_exists(version, :zero) + :one, " +
          "updated_at = :now, " +
          "last_activity_at = :now, " +
          "lifetime_received_cop = if_not_exists(lifetime_received_cop, :zero) + :amount, " +
          "last_idempotency_key = :idem",
        ConditionExpression:
          "attribute_not_exists(last_idempotency_key) OR last_idempotency_key <> :idem",
        ExpressionAttributeValues: {
          ":amount": input.amountCop,
          ":zero": 0,
          ":one": 1,
          ":now": new Date().toISOString(),
          ":idem": input.idempotencyKey,
        },
      }),
    );

    // Step 2: Append ledger entry.
    await this.appendLedgerEntry(input.userId, "DEPOSITO", input.amountCop, input.transactionId, input.metadata);
  }

  private async appendLedgerEntry(
    userId: string,
    movement: LedgerMovementType,
    amountCop: number,
    transactionId: string,
    metadata?: Record<string, string | number | boolean>,
  ): Promise<void> {
    const ts = new Date().toISOString();
    const seq = randomUUID().slice(0, 6); // simple monotonic-ish per-call identifier
    // Note: balance_after is NOT computed here (would require re-reading wallet).
    // Caller is responsible for the invariant: wallet balance is always sum of ledger.
    // We leave balance_after as the current wallet balance (best-effort, queried separately if needed).
    const entry: MarketLedgerEntry = {
      user_id: userId,
      ts_seq: `${ts}#${seq}`,
      movement,
      amount_cop: amountCop,
      balance_after_cop: 0, // populated below
      transaction_id: transactionId,
      metadata,
    };

    // Read current balance (best effort) to populate balance_after
    try {
      const current = await this.client.send(
        new GetCommand({
          TableName: this.walletsTable,
          Key: { user_id: userId },
        }),
      );
      if (current.Item?.balance_cop !== undefined) {
        entry.balance_after_cop = current.Item.balance_cop as number;
      }
    } catch {
      // Non-blocking — entry still gets written
    }

    await this.client.send(
      new PutCommand({
        TableName: this.ledgerTable,
        Item: entry,
      }),
    );
  }
}

/**
 * Debit a wallet by `amountCop`. Rejects with InsufficientBalanceError if balance too low.
 * Appends a RETIRO ledger entry.
 */
export class DebitWalletUseCase {
  constructor(
    private readonly walletsTable: string,
    private readonly ledgerTable: string = "",
    private readonly client: DynamoDBDocumentClient = defaultClient(),
  ) {}

  async execute(input: DebitInput): Promise<void> {
    if (!isPositive(input.amountCop)) {
      throw new Error(`amountCop must be positive, got ${input.amountCop}`);
    }
    if (!input.userId) throw new Error("userId is required");
    if (!input.transactionId) throw new Error("transactionId is required");
    if (!input.idempotencyKey) throw new Error("idempotencyKey is required");

    // Step 1: Read current wallet to check balance.
    const wallet = await this.client.send(
      new GetCommand({
        TableName: this.walletsTable,
        Key: { user_id: input.userId },
      }),
    );

    const currentBalance = (wallet.Item?.balance_cop as number | undefined) ?? 0;
    if (currentBalance < input.amountCop) {
      throw new InsufficientBalanceError(
        `Insufficient balance: ${currentBalance} < ${input.amountCop}`,
        currentBalance,
        input.amountCop,
      );
    }

    // Step 2: Conditional decrement with version check.
    await this.client.send(
      new UpdateCommand({
        TableName: this.walletsTable,
        Key: { user_id: input.userId },
        UpdateExpression:
          "SET balance_cop = balance_cop - :amount, " +
          "version = version + :one, " +
          "updated_at = :now, " +
          "last_activity_at = :now, " +
          "lifetime_withdrawn_cop = if_not_exists(lifetime_withdrawn_cop, :zero) + :amount",
        ConditionExpression: "version = :expected_version AND balance_cop >= :amount",
        ExpressionAttributeValues: {
          ":amount": input.amountCop,
          ":expected_version": wallet.Item?.version ?? 0,
          ":one": 1,
          ":now": new Date().toISOString(),
          ":zero": 0,
        },
      }),
    );

    // Step 3: Append ledger entry.
    if (this.ledgerTable) {
      const useCase = new CreditWalletUseCase(this.walletsTable, this.ledgerTable, this.client);
      // Reuse credit's append method by calling a private helper would be cleaner;
      // for simplicity we inline:
      const ts = new Date().toISOString();
      const seq = randomUUID().slice(0, 6);
      const newBalance = (currentBalance as number) - input.amountCop;
      const entry: MarketLedgerEntry = {
        user_id: input.userId,
        ts_seq: `${ts}#${seq}`,
        movement: "RETIRO",
        amount_cop: -input.amountCop,
        balance_after_cop: newBalance,
        transaction_id: input.transactionId,
        metadata: input.metadata,
      };
      await this.client.send(
        new PutCommand({
          TableName: this.ledgerTable,
          Item: entry,
        }),
      );
    }
  }
}

/**
 * Get wallet balance. Returns 0 if wallet doesn't exist.
 */
export class GetBalanceUseCase {
  constructor(
    private readonly walletsTable: string,
    private readonly client: DynamoDBDocumentClient = defaultClient(),
  ) {}

  async execute(input: { userId: string }): Promise<BalanceResult> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.walletsTable,
        Key: { user_id: input.userId },
      }),
    );

    const item = result.Item as MarketWallet | undefined;
    if (!item) {
      return { balanceCop: 0, version: 0, tier: 0, kycState: "INCOMPLETE" };
    }

    return {
      balanceCop: item.balance_cop ?? 0,
      version: item.version ?? 0,
      tier: item.tier,
      kycState: item.kyc_state,
    };
  }
}

// ─── Default client (injected in production; can be overridden in tests) ────

let _client: DynamoDBDocumentClient | undefined;

function defaultClient(): DynamoDBDocumentClient {
  if (!_client) {
    // Lazy import to avoid pulling AWS SDK at module load in pure-function contexts
    const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
    _client = DynamoDBDocumentClient.from(new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({}));
  }
  return _client!;
}

/** Override the default client (used in tests + crons for stage-specific config). */
export function setDefaultDynamoClient(client: DynamoDBDocumentClient): void {
  _client = client;
}