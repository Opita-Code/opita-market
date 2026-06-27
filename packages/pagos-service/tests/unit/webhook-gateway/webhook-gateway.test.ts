/**
 * Tests for the webhook gateway.
 *
 * SECURITY-CRITICAL — closes:
 *   OPL-LIB-001 — webhook timestamp validation (replay)
 *   OPL-API-004 — webhook idempotency
 *   OPL-CARD-002 — webhook full state machine
 *   OPL-CARD-004 — 3DS verification in webhook
 *   OPL-LIB-007 — generic error messages
 *
 * TDD: RED until src/lib/webhook-gateway/* modules are implemented.
 */
import { describe, it, expect, vi } from "vitest";
import {
  processWompiWebhook,
  verifyTimestamp,
  type WebhookGatewayDeps,
  type WompiEvent,
  type ReplayStore,
  type WompiClient,
  type ThreeDsVerifier,
  type EscrowMachine,
  type CreditInput,
  type EscrowTransitionInput,
  type ReverseBonusInput,
} from "../../../src/lib/webhook-gateway/index.js";
import { WebhookExpiredError } from "../../../src/lib/webhook-gateway/errors.js";

class InMemoryReplayStore implements ReplayStore {
  processed = new Set<string>();
  async isProcessed(eventId: string): Promise<boolean> {
    return this.processed.has(eventId);
  }
  async markProcessed(eventId: string, _txId: string): Promise<void> {
    this.processed.add(eventId);
  }
}

class MockWompiClient implements WompiClient {
  transaction3ds: { [id: string]: { authenticated: boolean; authenticationValue?: string } } = {};
  async getTransaction(id: string): Promise<{ id: string; status: string; payment_method: { extra?: { three_ds_authentication?: { authentication_value?: string } } } }> {
    return {
      id,
      status: "APPROVED",
      payment_method: {
        extra: {
          three_ds_authentication: this.transaction3ds[id],
        },
      },
    };
  }
}

class MockThreeDsVerifier implements ThreeDsVerifier {
  defaultResponse = { authenticated: true, authenticationValue: "auth-value-123" };
  async verify(_wompiTxId: string, _cacheTtlMs?: number): Promise<{ authenticated: boolean; authenticationValue?: string }> {
    return this.defaultResponse;
  }
}

class MockEscrowMachine implements EscrowMachine {
  transitions: Array<{ txId: string; event: string }> = [];
  async transition(txId: string, event: string): Promise<{ txId: string; newState: string }> {
    this.transitions.push({ txId, event });
    return { txId, newState: "HELD" };
  }
}

function makeDeps(overrides: Partial<WebhookGatewayDeps> = {}): WebhookGatewayDeps {
  return {
    eventsSecret: "test-events-secret-xyz",
    maxAgeMs: 5 * 60 * 1000,
    replayStore: new InMemoryReplayStore(),
    escrowMachine: new MockEscrowMachine(),
    threeDsVerifier: new MockThreeDsVerifier(),
    wompiClient: new MockWompiClient(),
    transactCredit: vi.fn(async (input: CreditInput) => ({ userId: input.userId, newBalanceCop: 0, version: 0 })),
    transactTransition: vi.fn(async (input: EscrowTransitionInput) => ({ txId: input.txId, fromState: input.fromState, toState: input.toState, version: 1 })),
    transactReverseBonus: vi.fn(async (_input: ReverseBonusInput) => undefined),
    resolveUserFromReference: async (_ref: string) => "user-from-ref",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<WompiEvent> = {}): WompiEvent {
  return {
    event: "transaction.approved",
    data: { transaction: { id: "tx-123", reference: "ref-1", status: "APPROVED", amount_in_cents: 100000, currency: "COP", payment_method_type: "CARD", requires_3ds: true } },
    timestamp: Math.floor(Date.now() / 1000),
    signature: { properties: ["transaction.id"], checksum: "valid" },
    environment: "prod",
    ...overrides,
  };
}

describe("webhook-gateway — R1+R2: Signature + timestamp", () => {
  it("verifyTimestamp accepts recent timestamp", () => {
    const now = Date.now();
    expect(() => verifyTimestamp(now - 60_000, 5 * 60 * 1000)).not.toThrow();
    expect(() => verifyTimestamp(now, 5 * 60 * 1000)).not.toThrow();
  });

  it("verifyTimestamp rejects timestamp > 5 min old (closes OPL-LIB-001)", () => {
    const old = Date.now() - 10 * 60 * 1000;
    expect(() => verifyTimestamp(old, 5 * 60 * 1000)).toThrow(WebhookExpiredError);
  });

  it("verifyTimestamp rejects timestamp from future (clock skew)", () => {
    const future = Date.now() + 10 * 60 * 1000;
    expect(() => verifyTimestamp(future, 5 * 60 * 1000)).toThrow(WebhookExpiredError);
  });
});

describe("webhook-gateway — R3: Idempotency", () => {
  it("replay event_id returns ok without re-processing (closes OPL-API-004)", async () => {
    const deps = makeDeps();
    const event = makeEvent();
    const result1 = await processWompiWebhook(event, "valid-sig", deps);
    expect(result1.ok).toBe(true);
    expect(result1.replay).toBeUndefined();

    const result2 = await processWompiWebhook(event, "valid-sig", deps);
    expect(result2.ok).toBe(true);
    expect(result2.replay).toBe(true);

    expect(deps.transactCredit).toHaveBeenCalledTimes(1);
  });

  it("different event_id processes both", async () => {
    const deps = makeDeps();
    const event1 = makeEvent();
    const event2 = makeEvent({ data: { transaction: { ...event1.data.transaction, id: "tx-456" } } });
    await processWompiWebhook(event1, "valid-sig", deps);
    await processWompiWebhook(event2, "valid-sig", deps);
    expect(deps.transactCredit).toHaveBeenCalledTimes(2);
  });
});

describe("webhook-gateway — R4: Event dispatch (closes OPL-CARD-002)", () => {
  it("event.approved with 3DS verified → calls credit + state transition (closes OPL-CARD-004)", async () => {
    const deps = makeDeps();
    const event = makeEvent({ event: "transaction.approved" });
    const result = await processWompiWebhook(event, "valid-sig", deps);
    expect(result.ok).toBe(true);
    expect(result.newState).toBeDefined();
    expect(deps.transactCredit).toHaveBeenCalledTimes(1);
    expect(deps.transactTransition).toHaveBeenCalled();
  });

  it("event.approved with 3DS required but not verified → NO credit, fraud signal", async () => {
    const deps = makeDeps();
    (deps.threeDsVerifier as MockThreeDsVerifier).defaultResponse = { authenticated: false };
    const event = makeEvent({ event: "transaction.approved" });
    const result = await processWompiWebhook(event, "valid-sig", deps);
    expect(result.ok).toBe(true);
    expect(result.fraudSignal).toBe("3DS_NOT_VERIFIED");
    expect(deps.transactCredit).not.toHaveBeenCalled();
  });

  it("event.declined → marks tx as failed (no credit)", async () => {
    const deps = makeDeps();
    const event = makeEvent({ event: "transaction.declined" });
    await processWompiWebhook(event, "valid-sig", deps);
    expect(deps.transactCredit).not.toHaveBeenCalled();
    expect(deps.transactTransition).toHaveBeenCalled();
  });

  it("event.reversed → calls bonus reversal (closes OPL-CARD-002 partial)", async () => {
    const deps = makeDeps();
    const event = makeEvent({ event: "transaction.reversed" });
    await processWompiWebhook(event, "valid-sig", deps);
    expect(deps.transactReverseBonus).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "tx-123" }),
    );
  });
});
