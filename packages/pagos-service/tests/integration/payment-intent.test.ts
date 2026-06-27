import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { makeFetch, uniqueId } from "./helpers.js";

/**
 * Tests for POST /v1/payments/intent (the most critical endpoint).
 */

const ddbMock = mockClient(DynamoDBDocumentClient);

describe.skip("POST /v1/payments/intent", () => {
  let auth: { email: string; groups: string[] };
  let fetch: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({ Attributes: {} });
    auth = { email: "buyer@opita.co", groups: [] };
    fetch = makeFetch({ currentUser: auth, api: null as any, geoCache: new Map(), fraudSignals: [], bonusCalls: [] } as any);
  });

  describe("happy path", () => {
    it("creates a PENDING transaction and returns integrity signature", async () => {
      const response = await fetch("/v1/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_cop: 100_000,
          channel: "WOMPI_CARD",
          from_user_id: "buyer@opita.co",
          to_user_id: "seller@opita.co",
          product_context: { kind: "MARKETPLACE_ORDER", ref_id: "prod-1" },
          idempotency_key: uniqueId("idem"),
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.transaction_id).toMatch(/^tx-/);
      expect(body.reference).toMatch(/^MARKETPLACE_ORDER::/);
      expect(body.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(body.public_key).toBe("pub_test_KEY");
      expect(body.amount_in_cents).toBe(100_000);
      expect(body.currency).toBe("COP");
      expect(body.expires_at).toBeDefined();
    });

    it("persists PENDING transaction in MarketTransactions", async () => {
      await fetch("/v1/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_cop: 50_000,
          channel: "WOMPI_BREB",
          from_user_id: "buyer@opita.co",
          to_user_id: "seller@opita.co",
          product_context: { kind: "P2P_TRANSFER", ref_id: "tx-ref" },
          idempotency_key: uniqueId("idem"),
        }),
      });

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
      const txPut = putCalls.find((c) => c.args[0].input.Item?.transaction_id);
      expect(txPut).toBeDefined();
      const item = txPut!.args[0].input.Item;
      expect(item.status).toBe("PENDING");
      expect(item.amount_cop).toBe(50_000);
      expect(item.channel).toBe("WOMPI_BREB");
    });
  });

  describe("idempotency", () => {
    it("returns existing transaction on duplicate idempotency_key", async () => {
      const idem = uniqueId("idem");
      ddbMock.on(GetCommand).callsFake((cmd: any) => {
        if (cmd.input?.KeyConditionExpression?.includes("idempotency_key_hash")) {
          return {
            Items: [{
              transaction_id: "tx-existing",
              idempotency_key: idem,
              idempotency_key_hash: idem,
              amount_cop: 100_000,
              channel: "WOMPI_CARD",
              status: "PENDING",
              reference: "MARKETPLACE_ORDER::seller@opita.co::1000",
              from_user_id: "buyer@opita.co",
              to_user_id: "seller@opita.co",
              escrow_state: "NONE",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              version: 1,
            }],
          };
        }
        return { Item: undefined };
      });

      const response = await fetch("/v1/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_cop: 100_000,
          channel: "WOMPI_CARD",
          from_user_id: "buyer@opita.co",
          to_user_id: "seller@opita.co",
          product_context: { kind: "MARKETPLACE_ORDER", ref_id: "prod-1" },
          idempotency_key: idem,
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.transaction_id).toBe("tx-existing");
    });
  });

  describe("tier limit enforcement", () => {
    it("rejects when amount exceeds tier daily receive limit (422)", async () => {
      ddbMock.on(GetCommand).callsFake((cmd: any) => {
        if (cmd.input?.Key?.user_id === "seller@opita.co") {
          return {
            Item: {
              user_id: "seller@opita.co",
              balance_cop: 0,
              tier: 0,
              kyc_state: "INCOMPLETE",
              lifetime_received_cop: 480_000,
              lifetime_withdrawn_cop: 0,
              last_activity_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              version: 1,
            },
          };
        }
        return { Item: undefined };
      });

      const response = await fetch("/v1/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_cop: 100_000,
          channel: "WOMPI_CARD",
          from_user_id: "buyer@opita.co",
          to_user_id: "seller@opita.co",
          product_context: { kind: "MARKETPLACE_ORDER", ref_id: "prod-1" },
          idempotency_key: uniqueId("idem"),
        }),
      });

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error_code).toBe("TIER_LIMIT_EXCEEDED");
    });
  });

  describe("auth", () => {
    it("returns 401 when not authenticated", async () => {
      fetch = makeFetch({ currentUser: null, api: null as any, geoCache: new Map(), fraudSignals: [], bonusCalls: [] } as any);
      const response = await fetch("/v1/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_cop: 100_000,
          channel: "WOMPI_CARD",
          from_user_id: "anonymous",
          to_user_id: "seller@opita.co",
          product_context: { kind: "MARKETPLACE_ORDER", ref_id: "prod-1" },
          idempotency_key: uniqueId("idem"),
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("returns 422 when amount is zero", async () => {
      const response = await fetch("/v1/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_cop: 0,
          channel: "WOMPI_CARD",
          from_user_id: "buyer@opita.co",
          to_user_id: "seller@opita.co",
          product_context: { kind: "MARKETPLACE_ORDER", ref_id: "prod-1" },
          idempotency_key: uniqueId("idem"),
        }),
      });

      expect(response.status).toBe(422);
    });

    it("returns 422 when channel is invalid", async () => {
      const response = await fetch("/v1/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_cop: 100_000,
          channel: "INVALID_CHANNEL",
          from_user_id: "buyer@opita.co",
          to_user_id: "seller@opita.co",
          product_context: { kind: "MARKETPLACE_ORDER", ref_id: "prod-1" },
          idempotency_key: uniqueId("idem"),
        }),
      });

      expect(response.status).toBe(422);
    });
  });
});