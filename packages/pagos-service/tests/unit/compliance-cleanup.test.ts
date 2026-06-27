import { describe, it, expect, beforeEach } from "vitest";
import {
  HabeasDataService,
  InMemoryOppositionStore,
  type OppositionStore,
} from "../../src/lib/habeas-data.js";
import {
  COOLING_OFF_DAYS,
  COOLING_OFF_PERIOD_MS,
  isWithinCoolingOff,
  canWithdraw,
  type WithdrawalCheckInput,
} from "../../src/lib/withdrawal-cooling-off.js";
import {
  CancellationService,
  InMemoryCancellationStore,
  CANCELLABLE_STATES,
  type CancellationStore,
} from "../../src/lib/transaction-cancellation.js";
import { InvalidStateError } from "../../src/lib/errors.js";

/**
 * Tests for PR 5 — Compliance cleanup (backend).
 *
 * Closes:
 *   - OPL-COMP-002 (opposition REST endpoint for Habeas Data right)
 *   - OPL-COMP-008 (5-day cooling-off period for withdrawals)
 *   - OPL-COMP-021 (TOS acceptance record)
 *   - OPL-COMP-022 (payment cancellation mechanism post-payment)
 *
 * Skipped (require frontend/legal):
 *   - OPL-COMP-001 (PTD missing DPO phone — needs legal doc update)
 *   - OPL-COMP-003 (age verification — needs frontend form)
 *   - OPL-COMP-004 (Aviso de Privacidad details — legal doc)
 *   - OPL-COMP-005 (TTLs in PTD — legal doc + code constants)
 *   - OPL-COMP-007 (Tier 4 unlimited withdrawals check — already enforced)
 *   - OPL-COMP-009 (refund policy visible — frontend)
 *   - OPL-COMP-010 (TOS page — frontend)
 *   - OPL-COMP-011 (Wompi fees disclosed — frontend checkout)
 *   - OPL-COMP-013 (Libro de quejas link — frontend)
 */

// ─── OPL-COMP-002: Habeas Data opposition ────────────────────────────────────

describe("PR 5 — Habeas Data opposition (Ley 1581 Art. 9)", () => {
  let store: OppositionStore;
  let service: HabeasDataService;

  beforeEach(() => {
    store = new InMemoryOppositionStore();
    service = new HabeasDataService({ store });
  });

  it("submitOpposition stores request with status RECEIVED", async () => {
    const request = await service.submitOpposition({
      userId: "u-1",
      requestType: "OPPOSITION",
      reason: "No longer wish to receive marketing",
    });
    expect(request.requestId).toBeDefined();
    expect(request.status).toBe("RECEIVED");
    expect(request.userId).toBe("u-1");
  });

  it("submitOpposition validates userId is non-empty", async () => {
    await expect(
      service.submitOpposition({
        userId: "",
        requestType: "OPPOSITION",
        reason: "test",
      }),
    ).rejects.toThrow(/userId/);
  });

  it("submitOpposition validates requestType is one of allowed values", async () => {
    await expect(
      service.submitOpposition({
        userId: "u-1",
        requestType: "INVALID" as any,
        reason: "test",
      }),
    ).rejects.toThrow(/requestType/);
  });

  it("getOppositionStatus returns latest request for user", async () => {
    await service.submitOpposition({ userId: "u-2", requestType: "OPPOSITION", reason: "r1" });
    await service.submitOpposition({ userId: "u-2", requestType: "DELETION", reason: "r2" });

    const status = await service.getOppositionStatus("u-2");
    expect(status.length).toBe(2);
    expect(status.map((s) => s.requestType)).toContain("OPPOSITION");
    expect(status.map((s) => s.requestType)).toContain("DELETION");
  });

  it("supports all 4 Ley 1581 Art. 9 rights", async () => {
    const rights = ["ACCESS", "UPDATE", "OPPOSITION", "DELETION"] as const;
    for (const right of rights) {
      const req = await service.submitOpposition({ userId: "u-3", requestType: right, reason: `test ${right}` });
      expect(req.requestType).toBe(right);
      expect(req.status).toBe("RECEIVED");
    }
  });

  it("assigns acknowledgment deadline (10 business days per Ley 1581)", async () => {
    const req = await service.submitOpposition({
      userId: "u-4",
      requestType: "ACCESS",
      reason: "test",
    });
    const deadlineMs = new Date(req.acknowledgmentDeadlineIso).getTime();
    const submittedMs = new Date(req.submittedAtIso).getTime();
    const days = (deadlineMs - submittedMs) / (24 * 60 * 60 * 1000);
    // 10 business days ≈ 14 calendar days (with weekends)
    expect(days).toBeGreaterThanOrEqual(13);
    expect(days).toBeLessThanOrEqual(15);
  });
});

// ─── OPL-COMP-008: 5-day cooling-off period ─────────────────────────────────

describe("PR 5 — Withdrawal cooling-off period (5 days, Decreto 222/2020)", () => {
  it("COOLING_OFF_DAYS is 5 per Decreto 222/2020", () => {
    expect(COOLING_OFF_DAYS).toBe(5);
  });

  it("COOLING_OFF_PERIOD_MS is 5 days in ms", () => {
    expect(COOLING_OFF_PERIOD_MS).toBe(5 * 24 * 60 * 60 * 1000);
  });

  it("isWithinCoolingOff returns true for recent deposits", () => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    expect(isWithinCoolingOff(twoDaysAgo, now)).toBe(true);
  });

  it("isWithinCoolingOff returns false for deposits > 5 days old", () => {
    const now = Date.now();
    const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;
    expect(isWithinCoolingOff(sixDaysAgo, now)).toBe(false);
  });

  it("canWithdraw returns false during cooling-off (throws via InvalidStateError)", () => {
    const input: WithdrawalCheckInput = {
      userId: "u-cooling",
      amountCop: 1_000_000,
      oldestUnreleasedDepositIso: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      nowIso: new Date().toISOString(),
    };
    expect(() => canWithdraw(input)).toThrow();
  });

  it("canWithdraw returns true after cooling-off period elapsed", () => {
    const input: WithdrawalCheckInput = {
      userId: "u-cooling",
      amountCop: 1_000_000,
      oldestUnreleasedDepositIso: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      nowIso: new Date().toISOString(),
    };
    expect(() => canWithdraw(input)).not.toThrow();
  });
});

// ─── OPL-COMP-022: Payment cancellation ──────────────────────────────────────

describe("PR 5 — Payment cancellation (post-payment intent, pre-webhook)", () => {
  let store: CancellationStore;
  let service: CancellationService;

  beforeEach(() => {
    store = new InMemoryCancellationStore();
    service = new CancellationService({ store });
  });

  it("CANCELLABLE_STATES includes PENDING (intent created, no Wompi response yet)", () => {
    expect(CANCELLABLE_STATES).toContain("PENDING");
  });

  it("cancelPaymentIntent succeeds when state is PENDING", async () => {
    const tx = await service.createPaymentIntent({
      txId: "tx-cancel-1",
      userId: "u-cancel",
      amountCop: 500_000,
      state: "PENDING",
    });
    await service.cancelPaymentIntent({
      txId: tx.txId,
      userId: "u-cancel",
      reason: "user-changed-mind",
    });
    const fetched = await service.getTransaction(tx.txId);
    expect(fetched?.state).toBe("CANCELLED");
    expect(fetched?.cancelledAtIso).toBeDefined();
  });

  it("cancelPaymentIntent fails when state is APPROVED (already processed)", async () => {
    const tx = await service.createPaymentIntent({
      txId: "tx-cancel-2",
      userId: "u-cancel",
      amountCop: 500_000,
      state: "APPROVED",
    });
    await expect(
      service.cancelPaymentIntent({
        txId: tx.txId,
        userId: "u-cancel",
        reason: "user-changed-mind",
      }),
    ).rejects.toThrow(InvalidStateError);
  });

  it("cancelPaymentIntent fails when user is not the creator (IDOR protection)", async () => {
    const tx = await service.createPaymentIntent({
      txId: "tx-cancel-3",
      userId: "u-creator",
      amountCop: 500_000,
      state: "PENDING",
    });
    await expect(
      service.cancelPaymentIntent({
        txId: tx.txId,
        userId: "u-attacker",
        reason: "user-changed-mind",
      }),
    ).rejects.toThrow();
  });

  it("cancelPaymentIntent is idempotent (cancelling twice succeeds)", async () => {
    const tx = await service.createPaymentIntent({
      txId: "tx-cancel-4",
      userId: "u-cancel",
      amountCop: 500_000,
      state: "PENDING",
    });
    await service.cancelPaymentIntent({ txId: tx.txId, userId: "u-cancel", reason: "r1" });
    await service.cancelPaymentIntent({ txId: tx.txId, userId: "u-cancel", reason: "r2" });
    const fetched = await service.getTransaction(tx.txId);
    expect(fetched?.state).toBe("CANCELLED");
  });
});

// ─── OPL-COMP-021: TOS acceptance record ─────────────────────────────────────

describe("PR 5 — TOS acceptance record (Habeas Data + Estatuto 1480)", () => {
  let store: OppositionStore;
  let service: HabeasDataService;

  beforeEach(() => {
    store = new InMemoryOppositionStore();
    service = new HabeasDataService({ store });
  });

  it("records TOS acceptance with version + timestamp", async () => {
    const acceptance = await service.recordTosAcceptance({
      userId: "u-tos-1",
      tosVersion: "2026-06-27",
      ipAddress: "192.0.2.1",
      userAgent: "Mozilla/5.0 ...",
    });
    expect(acceptance.userId).toBe("u-tos-1");
    expect(acceptance.tosVersion).toBe("2026-06-27");
    expect(acceptance.acceptedAtIso).toBeDefined();
    expect(acceptance.ipAddress).toBe("192.0.2.1");
  });

  it("rejects empty userId on TOS acceptance", async () => {
    await expect(
      service.recordTosAcceptance({
        userId: "",
        tosVersion: "2026-06-27",
        ipAddress: "1.2.3.4",
        userAgent: "x",
      }),
    ).rejects.toThrow();
  });
});
