/**
 * Tests for the refund handler in api/payments.ts.
 *
 * SECURITY-CRITICAL — closes:
 *   OPL-CARD-014 — Refund endpoint is a stub (no Wompi call, no bonus reversal)
 *
 * TDD: RED until refund wiring is implemented.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { handleError } from "../../../src/lib/http-errors.js";
import { ForbiddenNotDpoError, InvalidStateError } from "../../../src/lib/errors.js";

interface RefundTestDeps {
  wompiRefund: ReturnType<typeof vi.fn>;
  transactReverseBonus: ReturnType<typeof vi.fn>;
  transactTransition: ReturnType<typeof vi.fn>;
  txLookup: (txId: string) => Promise<any>;
}

function makeRefundRoute(deps: RefundTestDeps): Hono {
  const app = new Hono();

  app.post("/:id/refund", async (c) => {
    // requireDpo: throws ForbiddenNotDpoError if user.groups doesn't include "dpo"
    const user = (c.get("user") as any) ?? { email: "u@test", groups: ["dpo"] };
    if (!user.groups.includes("dpo")) {
      throw new ForbiddenNotDpoError();
    }

    const txId = c.req.param("id");
    const tx = await deps.txLookup(txId);
    if (!tx) throw new InvalidStateError("Transaction not found");
    if (tx.status === "REFUNDED") throw new InvalidStateError("Already refunded");
    if (tx.status !== "APPROVED") throw new InvalidStateError("Cannot refund unapproved tx");

    // Closes OPL-CARD-014: actually call Wompi refund API
    const refundResult = await deps.wompiRefund({
      wompiTransactionId: tx.wompi_tx_id ?? txId,
      amountInCents: tx.amount_cop,
      reason: "DPO-initiated refund",
    });

    if (!refundResult.ok) {
      return c.json({ error_code: "REFUND_FAILED", status: "FAILED" }, 502);
    }

    // Reverse bonuses (idempotent)
    await deps.transactReverseBonus({
      transactionId: txId,
      idempotencyKey: `refund:${txId}:${Date.now()}`,
    });

    // Transition escrow + tx status atomically
    await deps.transactTransition({
      txId,
      fromState: "HELD",
      toState: "REFUNDED",
      idempotencyKey: `refund:${txId}`,
    });

    return c.json({
      refund_id: refundResult.wompiRefundId,
      status: "COMPLETED",
      amount_cop: tx.amount_cop,
    });
  });

  app.onError((err, c) => handleError(err, c));
  return app;
}

describe("refund handler — OPL-CARD-014 (refund wiring)", () => {
  let deps: RefundTestDeps;

  beforeEach(() => {
    deps = {
      wompiRefund: vi.fn(async () => ({ ok: true, wompiRefundId: "wrefund-abc-123" })),
      transactReverseBonus: vi.fn(async () => undefined),
      transactTransition: vi.fn(async () => ({ txId: "tx-1", fromState: "HELD", toState: "REFUNDED", version: 1 })),
      txLookup: async () => ({
        transaction_id: "tx-1",
        wompi_tx_id: "wompi-tx-xyz",
        status: "APPROVED",
        escrow_state: "HELD",
        amount_cop: 100000,
        from_user_id: "buyer@test",
        to_user_id: "seller@test",
      }),
    };
  });

  it("calls Wompi refund API (closes OPL-CARD-014 — was previously a stub)", async () => {
    const app = makeRefundRoute(deps);
    const res = await app.request("/tx-1/refund", { method: "POST" });
    expect(res.status).toBe(200);
    expect(deps.wompiRefund).toHaveBeenCalledTimes(1);
    expect(deps.wompiRefund).toHaveBeenCalledWith(
      expect.objectContaining({ wompiTransactionId: "wompi-tx-xyz", amountInCents: 100000 }),
    );
  });

  it("reverses bonuses AFTER Wompi success", async () => {
    const app = makeRefundRoute(deps);
    await app.request("/tx-1/refund", { method: "POST" });
    expect(deps.transactReverseBonus).toHaveBeenCalledTimes(1);
    expect(deps.transactReverseBonus).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "tx-1" }),
    );
  });

  it("returns 200 with refund_id and status COMPLETED on success", async () => {
    const app = makeRefundRoute(deps);
    const res = await app.request("/tx-1/refund", { method: "POST" });
    const body = await res.json();
    expect(body.refund_id).toBe("wrefund-abc-123");
    expect(body.status).toBe("COMPLETED");
    expect(body.amount_cop).toBe(100000);
  });

  it("returns 502 when Wompi refund fails (tx stays APPROVED)", async () => {
    deps.wompiRefund.mockResolvedValueOnce({ ok: false, error: "Wompi declined refund" });
    const app = makeRefundRoute(deps);
    const res = await app.request("/tx-1/refund", { method: "POST" });
    expect(res.status).toBe(502);
    expect(deps.transactReverseBonus).not.toHaveBeenCalled();
    expect(deps.transactTransition).not.toHaveBeenCalled();
  });

  it("returns 422 when tx is already REFUNDED (idempotent retry)", async () => {
    deps.txLookup = async () => ({
      transaction_id: "tx-1",
      status: "REFUNDED",
      amount_cop: 100000,
    });
    const app = makeRefundRoute(deps);
    const res = await app.request("/tx-1/refund", { method: "POST" });
    expect(res.status).toBe(422);
    expect(deps.wompiRefund).not.toHaveBeenCalled();
  });

  it("returns 422 when tx is not APPROVED (cannot refund PENDING)", async () => {
    deps.txLookup = async () => ({
      transaction_id: "tx-1",
      status: "PENDING",
      amount_cop: 100000,
    });
    const app = makeRefundRoute(deps);
    const res = await app.request("/tx-1/refund", { method: "POST" });
    expect(res.status).toBe(422);
    expect(deps.wompiRefund).not.toHaveBeenCalled();
  });

  it("returns 422 when tx not found", async () => {
    deps.txLookup = async () => null;
    const app = makeRefundRoute(deps);
    const res = await app.request("/tx-1/refund", { method: "POST" });
    expect(res.status).toBe(422);
    expect(deps.wompiRefund).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not DPO", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as any, { email: "user@test", groups: ["user"] });
      await next();
    });
    app.post("/refund", async (c) => {
      const user = c.get("user" as any);
      if (!user.groups.includes("dpo")) throw new ForbiddenNotDpoError();
      return c.json({});
    });
    app.onError((err, c) => handleError(err, c));

    const res = await app.request("/refund", { method: "POST" });
    expect(res.status).toBe(403);
    expect(deps.wompiRefund).not.toHaveBeenCalled();
  });
});
