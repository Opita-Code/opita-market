import { describe, it, expect, beforeEach } from "vitest";
import { UiafMonitor, type UiafTransaction, type UiafAlerter } from "../../../crons/uiaf-monitor.js";

/**
 * Tests for UIAF (anti-money-laundering) monitor cron — hourly.
 *
 * Detects users whose 24h transaction volume exceeds COP $5M (Colombian
 * threshold for required reporting). Alerts the DPO via SES.
 */

const UIAF_THRESHOLD_COP = 5_000_000;

class FakeAlerter implements UiafAlerter {
  public alerts: Array<{ userId: string; amountCop: number }> = [];
  async sendAlert(userId: string, amountCop: number): Promise<void> {
    this.alerts.push({ userId, amountCop });
  }
}

function makeTx(userId: string, amountCop: number, hoursAgo: number): UiafTransaction {
  const ts = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return {
    transaction_id: `tx-${userId}-${amountCop}-${hoursAgo}`,
    user_id: userId,
    amount_cop: amountCop,
    created_at: ts,
    channel: "WOMPI_CARD",
    status: "APPROVED",
  };
}

class FakeTxStore {
  constructor(public txs: UiafTransaction[] = []) {}
  async getRecentTransactions(hoursBack: number): Promise<UiafTransaction[]> {
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
    return this.txs.filter((t) => new Date(t.created_at).getTime() >= cutoff);
  }
}

describe("uiaf-monitor cron", () => {
  let alerter: FakeAlerter;
  let store: FakeTxStore;

  beforeEach(() => {
    alerter = new FakeAlerter();
    store = new FakeTxStore();
  });

  describe("threshold detection", () => {
    it("alerts when user total > $5M COP in 24h", async () => {
      store.txs = [
        makeTx("u1", 3_000_000, 12),
        makeTx("u1", 3_000_000, 6), // total: 6M
      ];
      const cron = new UiafMonitor({ store, alerter });
      const result = await cron.run();
      expect(result.flagged).toBe(1);
      expect(alerter.alerts).toHaveLength(1);
      expect(alerter.alerts[0]).toEqual({ userId: "u1", amountCop: 6_000_000 });
    });

    it("does NOT alert when user total ≤ $5M COP in 24h", async () => {
      store.txs = [
        makeTx("u1", 2_000_000, 12),
        makeTx("u1", 2_500_000, 6), // total: 4.5M
      ];
      const cron = new UiafMonitor({ store, alerter });
      const result = await cron.run();
      expect(result.flagged).toBe(0);
      expect(alerter.alerts).toHaveLength(0);
    });

    it("alerts at exactly $5M (boundary inclusive)", async () => {
      store.txs = [makeTx("u1", 5_000_000, 12)];
      const cron = new UiafMonitor({ store, alerter });
      const result = await cron.run();
      expect(result.flagged).toBe(1);
    });
  });

  describe("multiple users", () => {
    it("flags only the ones above threshold", async () => {
      store.txs = [
        makeTx("u1", 6_000_000, 12), // flagged
        makeTx("u2", 1_000_000, 12), // not flagged
        makeTx("u3", 5_500_000, 6),  // flagged (total 5.5M)
      ];
      const cron = new UiafMonitor({ store, alerter });
      const result = await cron.run();
      expect(result.flagged).toBe(2);
      expect(alerter.alerts.map((a) => a.userId).sort()).toEqual(["u1", "u3"]);
    });
  });

  describe("24h window", () => {
    it("ignores transactions older than 24h", async () => {
      store.txs = [
        makeTx("u1", 3_000_000, 30), // 30h ago - outside window
        makeTx("u1", 3_000_000, 12), // 12h ago
        // total in window: 3M (below threshold)
      ];
      const cron = new UiafMonitor({ store, alerter, windowHours: 24 });
      const result = await cron.run();
      expect(result.flagged).toBe(0);
    });
  });

  describe("alert idempotency", () => {
    it("does NOT re-alert the same user within the same window", async () => {
      store.txs = [
        makeTx("u1", 3_000_000, 18),
        makeTx("u1", 3_000_000, 6),
      ];
      const flagged = new Set<string>();
      const cron = new UiafMonitor({
        store,
        alerter,
        alreadyFlagged: () => flagged,
        recordFlag: (key) => flagged.add(key),
      });
      await cron.run();
      await cron.run();
      // Only one alert (idempotent within window)
      expect(alerter.alerts.filter((a) => a.userId === "u1")).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("continues on alerter failure", async () => {
      store.txs = [makeTx("u1", 6_000_000, 12)];
      const failingAlerter: UiafAlerter = {
        sendAlert: async () => {
          throw new Error("SES unavailable");
        },
      };
      const cron = new UiafMonitor({ store, alerter: failingAlerter });
      const result = await cron.run();
      // When alerter fails: flagged stays 0 (we never successfully alerted),
      // errors increments to 1.
      expect(result.flagged).toBe(0);
      expect(result.errors).toBe(1);
    });
  });
});