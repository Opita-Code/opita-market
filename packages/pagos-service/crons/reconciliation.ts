/**
 * Reconciliation cron — daily 03:00 COL.
 *
 * Compares DynamoDB MarketTransactions with Wompi's authoritative transaction
 * state. Detects lost webhooks and missed chargebacks.
 *
 * WINDOW: 24h back from now.
 *
 * DETECTED CASES:
 *   1. DB PENDING  + Wompi APPROVED → update to APPROVED (lost APPROVED webhook)
 *   2. DB PENDING  + Wompi DECLINED → update to DECLINED (lost DECLINED webhook)
 *   3. DB APPROVED + Wompi CHARGEBACK → update to REFUNDED (missed chargeback)
 *   4. DB APPROVED + Wompi DECLINED → IGNORE (out-of-order webhook, transient)
 *
 * ERRORS are logged and counted; one failed Wompi lookup does NOT abort the run.
 */

import type { TransactionStatus } from "../db/tables.js";

export interface ReconciliationTransaction {
  transaction_id: string;
  wompi_tx_id: string;
  status: TransactionStatus;
  amount_cop: number;
  updated_at: string;
  webhook_events?: unknown[];
}

export interface ReconciliationStore {
  getRecentTransactions(hoursBack: number): Promise<ReconciliationTransaction[]>;
  updateTransactionStatus(
    transaction_id: string,
    status: TransactionStatus,
  ): Promise<void>;
  appendAuditLog(record: {
    event: string;
    transaction_id: string;
    detected_status: TransactionStatus;
    wompi_status: string;
    action: string;
    ts: string;
  }): Promise<void>;
}

export interface WompiTxLookup {
  lookup(wompiTxId: string): Promise<"APPROVED" | "DECLINED" | "VOIDED" | "ERROR" | "CHARGEBACK">;
}

export interface ReconciliationDeps {
  store: ReconciliationStore;
  wompi: WompiTxLookup;
  hoursBack?: number;
  now?: () => Date;
}

export interface ReconciliationResult {
  checked: number;
  discordance: number;
  corrections: number;
  errors: number;
}

export class ReconciliationCron {
  private readonly store: ReconciliationStore;
  private readonly wompi: WompiTxLookup;
  private readonly hoursBack: number;
  private readonly now: () => Date;

  constructor(deps: ReconciliationDeps) {
    this.store = deps.store;
    this.wompi = deps.wompi;
    this.hoursBack = deps.hoursBack ?? 24;
    this.now = deps.now ?? (() => new Date());
  }

  async run(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = { checked: 0, discordance: 0, corrections: 0, errors: 0 };
    const txs = await this.store.getRecentTransactions(this.hoursBack);
    result.checked = txs.length;

    for (const tx of txs) {
      if (!tx.wompi_tx_id) continue;

      let wompiStatus: Awaited<ReturnType<WompiTxLookup["lookup"]>>;
      try {
        wompiStatus = await this.wompi.lookup(tx.wompi_tx_id);
      } catch (err) {
        result.errors++;
        await this.log(tx, "WOMPI_LOOKUP_FAILED", "ERROR_LOGGED");
        continue;
      }

      const correction = this.compare(tx, wompiStatus);
      if (correction) {
        result.discordance++;
        await this.store.updateTransactionStatus(tx.transaction_id, correction);
        await this.log(tx, wompiStatus, correction);
        result.corrections++;
      }
    }

    return result;
  }

  /**
   * Returns the corrective status if DB is out of sync, null if in sync.
   * Returns "REFUNDED" when Wompi says CHARGEBACK (regardless of DB state).
   */
  private compare(
    tx: ReconciliationTransaction,
    wompiStatus: "APPROVED" | "DECLINED" | "VOIDED" | "ERROR" | "CHARGEBACK",
  ): TransactionStatus | null {
    if (wompiStatus === "CHARGEBACK" && tx.status === "APPROVED") {
      return "REFUNDED";
    }

    if (tx.status === "PENDING") {
      if (wompiStatus === "APPROVED") return "APPROVED";
      if (wompiStatus === "DECLINED") return "DECLINED";
      if (wompiStatus === "VOIDED") return "VOIDED";
      if (wompiStatus === "ERROR") return "ERROR";
    }

    // Out-of-order webhooks: APPROVED in DB + transient DECLINED from Wompi = ignore
    return null;
  }

  private async log(
    tx: ReconciliationTransaction,
    wompiStatus: string,
    action: string,
  ): Promise<void> {
    await this.store.appendAuditLog({
      event: "RECONCILIATION_DISCORDANCE",
      transaction_id: tx.transaction_id,
      detected_status: tx.status,
      wompi_status: wompiStatus,
      action,
      ts: this.now().toISOString(),
    });
  }
}

/**
 * AWS Lambda handler wrapper for EventBridge cron trigger.
 * PR 6 wires this to `sst.aws.Cron` schedule `cron(0 3 * * ? *)` (3 AM COL).
 */
export async function handler(): Promise<ReconciliationResult> {
  // PR 6: instantiate with real DynamoDB + WompiClient + audit logger
  throw new Error("Not implemented in PR 5 — wire in PR 6");
}