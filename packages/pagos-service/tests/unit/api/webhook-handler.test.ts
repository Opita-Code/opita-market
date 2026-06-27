/**
 * Integration tests for the webhook handler in api/payments.ts.
 *
 * Closes OPL-DEP-001 (post-deploy pentest finding):
 *   POST /v1/payments/webhook returned HTTP 500 for malformed input.
 *   After PR 1.4c Option C: returns 400 (invalid JSON) or 401 (invalid sig).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { handleError } from "../../../src/lib/http-errors.js";
import { InMemoryReplayStore } from "../../../src/lib/replay-store/memory.js";
import { processWompiWebhook } from "../../../src/lib/webhook-gateway/index.js";
import { verifyWebhookSignature, generateIntegritySignature } from "../../../src/lib/wompi.js";
import { InvalidSignatureError } from "../../../src/lib/errors.js";
import * as crypto from "node:crypto";

const SECRET = "test-events-secret-1234567890";

function makeWebhookHandler(deps: {
  eventsSecret: string;
  replayStore: InMemoryReplayStore;
}): Hono {
  const escrowMachine = {
    transition: async (txId: string) => ({ txId, newState: "HELD" }),
  };
  const threeDsVerifier = {
    verify: async () => ({ authenticated: true, authenticationValue: "x" }),
  };
  const wompiClient = {
    getTransaction: async (id: string) => ({ id, status: "APPROVED", payment_method: { extra: {} } }),
  };
  const transactCredit = async () => ({ userId: "u", newBalanceCop: 0, version: 0 });
  const transactTransition = async (i: any) => ({ txId: i.txId, fromState: i.fromState, toState: i.toState, version: 1 });
  const transactReverseBonus = async () => {};
  const resolveUserFromReference = async () => "u";

  const app = new Hono();
  app.post("/webhook", async (c) => {
    const body = await c.req.json();
    if (!verifyWebhookSignature(body, deps.eventsSecret)) {
      throw new InvalidSignatureError();
    }
    const result = await processWompiWebhook(body, body?.signature?.checksum ?? "", {
      eventsSecret: deps.eventsSecret,
      maxAgeMs: 5 * 60 * 1000,
      replayStore: deps.replayStore,
      escrowMachine,
      threeDsVerifier,
      wompiClient,
      transactCredit,
      transactTransition,
      transactReverseBonus,
      resolveUserFromReference,
    });
    return c.json({ ok: result.ok, tx_id: result.txId, replay: result.replay });
  });
  app.onError((err, c) => handleError(err, c));
  return app;
}

function makeEvent(): any {
  return {
    event: "transaction.approved",
    data: { transaction: { id: "tx-123", reference: "ref-1", status: "APPROVED", amount_in_cents: 100000, currency: "COP", payment_method_type: "CARD", requires_3ds: false } },
    timestamp: Math.floor(Date.now() / 1000),
    signature: { properties: ["transaction.id"], checksum: "" },
    environment: "prod",
  };
}

/**
 * Sign event with the real Wompi HMAC-SHA256 algorithm so verifyWebhookSignature
 * (in src/lib/wompi.ts) returns true. Mirrors the production algorithm.
 */
function signEvent(event: any, secret: string): any {
  let concatenated = "";
  for (const prop of event.signature.properties) {
    const parts = prop.split(".");
    let val: any = event.data;
    for (const p of parts) val = val?.[p];
    concatenated += String(val);
  }
  concatenated += String(event.timestamp);
  concatenated += secret;
  const checksum = crypto.createHash("sha256").update(concatenated, "utf8").digest("hex");
  return { ...event, signature: { ...event.signature, checksum } };
}

describe("webhook handler — OPL-DEP-001 fix", () => {
  let app: Hono;
  let replayStore: InMemoryReplayStore;

  beforeEach(() => {
    replayStore = new InMemoryReplayStore();
    app = makeWebhookHandler({ eventsSecret: SECRET, replayStore });
  });

  it("returns 400 on invalid JSON (was 500 before fix)", async () => {
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("INVALID_JSON");
  });

  it("returns 400 on empty body (was 500 before fix)", async () => {
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 on invalid signature (with valid JSON)", async () => {
    const event = makeEvent();
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe("INVALID_SIGNATURE");
    // No info leak (closes OPL-LIB-007)
    expect(body.message).not.toContain("transaction");
    expect(body.message).not.toContain("signature");
  });

  it("returns 200 on valid signature + new event", async () => {
    const event = signEvent(makeEvent(), SECRET);
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tx_id).toBe("tx-123");
    expect(body.replay).toBeUndefined();
  });

  it("returns 200 on replay (second delivery = replay=true, no double processing)", async () => {
    const event = signEvent(makeEvent(), SECRET);
    const body = JSON.stringify(event);
    // First delivery
    const r1 = await app.request("/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const b1 = await r1.json();
    expect(b1.replay).toBeUndefined();
    // Second delivery (Wompi retry)
    const r2 = await app.request("/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const b2 = await r2.json();
    expect(r2.status).toBe(200);
    expect(b2.replay).toBe(true);
    // The transactCredit mock is called only once (closes OPL-API-004)
  });
});
