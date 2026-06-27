/**
 * Transaction cancellation (PR 5 — closes OPL-COMP-022).
 *
 * After payment intent creation, user can cancel before Wompi webhook fires
 * APPROVED. Once APPROVED, transaction is in HELD escrow state — cancellation
 * requires refund flow (different lifecycle).
 *
 * Design:
 *   - CANCELLABLE_STATES = ["PENDING"]
 *   - Cancelling twice is idempotent (state already CANCELLED → no-op)
 *   - Only the original creator can cancel (IDOR protection)
 */

import { InvalidStateError } from "./errors.js";

export type CancellableTransactionState = "PENDING";
export type TransactionState = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "REFUNDED" | "VOIDED";

/** States in which a transaction can be cancelled by the creator. */
export const CANCELLABLE_STATES: CancellableTransactionState[] = ["PENDING"];

export interface CancellableTransaction {
  txId: string;
  userId: string;
  amountCop: number;
  state: TransactionState;
  createdAtIso: string;
  cancelledAtIso?: string;
  cancelReason?: string;
}

export interface CancellationStore {
  /** Upsert (idempotent). */
  save(tx: CancellableTransaction): Promise<void>;
  get(txId: string): Promise<CancellableTransaction | null>;
}

export class InMemoryCancellationStore implements CancellationStore {
  private txs = new Map<string, CancellableTransaction>();

  async save(tx: CancellableTransaction): Promise<void> {
    this.txs.set(tx.txId, tx);
  }

  async get(txId: string): Promise<CancellableTransaction | null> {
    return this.txs.get(txId) ?? null;
  }

  clear(): void {
    this.txs.clear();
  }
}

export interface CancellationServiceDeps {
  store: CancellationStore;
  now?: () => Date;
}

export class CancellationService {
  private readonly store: CancellationStore;
  private readonly now: () => Date;

  constructor(deps: CancellationServiceDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
  }

  async createPaymentIntent(input: {
    txId: string;
    userId: string;
    amountCop: number;
    state: TransactionState;
  }): Promise<CancellableTransaction> {
    if (!input.txId || input.userId.length === 0) {
      throw new Error("cancellation: txId and userId are required");
    }
    const tx: CancellableTransaction = {
      txId: input.txId,
      userId: input.userId,
      amountCop: input.amountCop,
      state: input.state,
      createdAtIso: new Date(this.now().getTime()).toISOString(),
    };
    await this.store.save(tx);
    return tx;
  }

  async cancelPaymentIntent(input: { txId: string; userId: string; reason: string }): Promise<CancellableTransaction> {
    const tx = await this.store.get(input.txId);
    if (!tx) {
      throw new InvalidStateError(`Transaction ${input.txId} not found`);
    }
    if (tx.userId !== input.userId) {
      throw new InvalidStateError("Only the creator can cancel this transaction");
    }

    // Idempotent: if already cancelled, return current state
    if (tx.state === "CANCELLED") {
      return tx;
    }

    // Check cancellable state
    if (!(CANCELLABLE_STATES as TransactionState[]).includes(tx.state)) {
      throw new InvalidStateError(
        `Transaction in state ${tx.state} cannot be cancelled. Only PENDING transactions can be cancelled.`,
      );
    }

    const cancelled: CancellableTransaction = {
      ...tx,
      state: "CANCELLED",
      cancelledAtIso: new Date(this.now().getTime()).toISOString(),
      cancelReason: input.reason,
    };
    await this.store.save(cancelled);
    return cancelled;
  }

  async getTransaction(txId: string): Promise<CancellableTransaction | null> {
    return this.store.get(txId);
  }
}
