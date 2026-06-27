import { describe, it, expect, beforeEach } from "vitest";
import { ReconciliationCron, type ReconciliationStore, type WompiTxLookup } from "../../../src/crons/reconciliation.js";

/**
 * Tests for the reconciliation cron.
 *
 * Detects:
 *   1. DynamoDB has PENDING but Wompi says APPROVED → webhooks lost, sync to APPROVED
 *   2. DynamoDB has PENDING but Wompi says DECLINED → sync to DECLINED
 *   3. DynamoDB has APPROVED but Wompi says CHARGEBACK → reverse to REFUNDED
 *   4. DynamoDB has APPROVED but Wompi says DECLINED → webhook out-of-order; ignore
 *
 * Window: 24h back from now.
 */

interface MockTx {
  transaction_id: string;
  wompi_tx_id: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "VOIDED" | "REFUNDED" | "ERROR";
  amount_cop: number;
  updated_at: string;
  webhook_events?: unknown[];
}

class FakeStore implements ReconciliationStore {
  constructor(public txs: MockTx[] = []) {}
  async getRecentTransactions(hoursBack: number): Promise<MockTx[]> {
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
    return this.txs.filter((t) => new Date(t.updated_at).getTime() >= cutoff);
  }
  async updateTransactionStatus(transaction_id: string, status: MockTx["status"]) {
    const tx = this.txs.find((t) => t.transaction_id === transaction_id);
    if (tx) {
      tx.status = status;
      tx.updated_at = new Date().toISOString();
    }
  }
  async appendAuditLog(record: any) {
    // no-op
  }
}

class FakeWompi implements WompiTxLookup {
  constructor(public responses: Map<string, "APPROVED" | "DECLINED" | "VOIDED" | "ERROR" | "CHARGEBACK"> = new Map()) {}
  async lookup(wompiTxId: string) {
    return this.responses.get(wompiTxId) ?? "APPROVED";
  }
}

describe("reconciliation cron", () => {
  let store: FakeStore;
  let wompi: FakeWompi;

  beforeEach(() => {
    store = new FakeStore();
    wompi = new FakeWompi();
  });

  describe("happy path (no discordance)", () => {
    it("returns 0 when all txs are in sync", async () => {
      store.txs = [
        { transaction_id: "tx-1", wompi_tx_id: "wompi-1", status: "APPROVED", amount_cop: 100_000, updated_at: new Date().toISOString() },
        { transaction_id: "tx-2", wompi_tx_id: "wompi-2", status: "DECLINED", amount_cop: 100_000, updated_at: new Date().toISOString() },
      ];
      wompi.responses.set("wompi-1", "APPROVED");
      wompi.responses.set("wompi-2", "DECLINED");

      const cron = new ReconciliationCron({ store, wompi, now: () => new Date("2026-06-26T12:00:00Z") });
      const result = await cron.run();
      expect(result.checked).toBe(2);
      expect(result.discordance).toBe(0);
      expect(result.corrections).toBe(0);
    });
  });

  describe("detects lost webhook (DB PENDING + Wompi APPROVED)", () => {
    it("updates DynamoDB to APPROVED", async () => {
      store.txs = [
        { transaction_id: "tx-1", wompi_tx_id: "wompi-1", status: "PENDING", amount_cop: 100_000, updated_at: new Date().toISOString() },
      ];
      wompi.responses.set("wompi-1", "APPROVED");

      const cron = new ReconciliationCron({ store, wompi });
      const result = await cron.run();
      expect(result.discordance).toBe(1);
      expect(result.corrections).toBe(1);
      expect(store.txs[0].status).toBe("APPROVED");
    });
  });

  describe("detects lost webhook (DB PENDING + Wompi DECLINED)", () => {
    it("updates DynamoDB to DECLINED", async () => {
      store.txs = [
        { transaction_id: "tx-1", wompi_tx_id: "wompi-1", status: "PENDING", amount_cop: 100_000, updated_at: new Date().toISOString() },
      ];
      wompi.responses.set("wompi-1", "DECLINED");

      const cron = new ReconciliationCron({ store, wompi });
      const result = await cron.run();
      expect(result.discordance).toBe(1);
      expect(store.txs[0].status).toBe("DECLINED");
    });
  });

  describe("detects missed chargeback", () => {
    it("updates DB APPROVED → REFUNDED when Wompi says CHARGEBACK", async () => {
      store.txs = [
        { transaction_id: "tx-1", wompi_tx_id: "wompi-1", status: "APPROVED", amount_cop: 100_000, updated_at: new Date().toISOString() },
      ];
      wompi.responses.set("wompi-1", "CHARGEBACK");

      const cron = new ReconciliationCron({ store, wompi });
      const result = await cron.run();
      expect(result.discordance).toBe(1);
      expect(store.txs[0].status).toBe("REFUNDED");
    });
  });

  describe("ignores out-of-order webhooks", () => {
    it("does NOT downgrade APPROVED when Wompi returns DECLINED", async () => {
      // Wompi may report transient states during async processing — only the
      // most "advanced" status counts. APPROVED is terminal (modulo chargeback).
      store.txs = [
        { transaction_id: "tx-1", wompi_tx_id: "wompi-1", status: "APPROVED", amount_cop: 100_000, updated_at: new Date().toISOString() },
      ];
      wompi.responses.set("wompi-1", "DECLINED");

      const cron = new ReconciliationCron({ store, wompi });
      const result = await cron.run();
      expect(result.discordance).toBe(0);
      expect(store.txs[0].status).toBe("APPROVED"); // unchanged
    });
  });

  describe("time window", () => {
    it("only checks transactions within 24h window", async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
      store.txs = [
        { transaction_id: "old-tx", wompi_tx_id: "wompi-old", status: "PENDING", amount_cop: 100_000, updated_at: oldDate },
      ];
      wompi.responses.set("wompi-old", "APPROVED");

      const cron = new ReconciliationCron({ store, wompi, hoursBack: 24 });
      const result = await cron.run();
      expect(result.checked).toBe(0);
    });
  });

  describe("multiple transactions", () => {
    it("checks all of them in one run", async () => {
      store.txs = [
        { transaction_id: "tx-1", wompi_tx_id: "wompi-1", status: "PENDING", amount_cop: 100_000, updated_at: new Date().toISOString() },
        { transaction_id: "tx-2", wompi_tx_id: "wompi-2", status: "APPROVED", amount_cop: 200_000, updated_at: new Date().toISOString() },
        { transaction_id: "tx-3", wompi_tx_id: "wompi-3", status: "PENDING", amount_cop: 50_000, updated_at: new Date().toISOString() },
      ];
      wompi.responses.set("wompi-1", "APPROVED");
      wompi.responses.set("wompi-2", "APPROVED");
      wompi.responses.set("wompi-3", "DECLINED");

      const cron = new ReconciliationCron({ store, wompi });
      const result = await cron.run();
      expect(result.checked).toBe(3);
      expect(result.discordance).toBe(2);
      expect(result.corrections).toBe(2);
      expect(store.txs.find((t) => t.transaction_id === "tx-1")!.status).toBe("APPROVED");
      expect(store.txs.find((t) => t.transaction_id === "tx-2")!.status).toBe("APPROVED");
      expect(store.txs.find((t) => t.transaction_id === "tx-3")!.status).toBe("DECLINED");
    });
  });

  describe("error handling", () => {
    it("continues on Wompi API errors (does not abort)", async () => {
      store.txs = [
        { transaction_id: "tx-1", wompi_tx_id: "wompi-1", status: "PENDING", amount_cop: 100_000, updated_at: new Date().toISOString() },
        { transaction_id: "tx-2", wompi_tx_id: "wompi-2", status: "PENDING", amount_cop: 100_000, updated_at: new Date().toISOString() },
      ];
      // First call fails, second succeeds
      let callCount = 0;
      const flakyWompi: WompiTxLookup = {
        lookup: async () => {
          callCount++;
          if (callCount === 1) throw new Error("Wompi 503");
          return "APPROVED";
        },
      };

      const cron = new ReconciliationCron({ store, wompi: flakyWompi });
      const result = await cron.run();
      expect(result.errors).toBe(1); // 1 error logged
      expect(result.discordance).toBe(1); // 1 correction
    });
  });
});