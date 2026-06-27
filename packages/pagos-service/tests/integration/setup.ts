/**
 * Vitest setup — runs before each test file.
 * Initializes globalThis.__testApp__ with a Hono app configured for tests.
 */

import { Hono } from "hono";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { initApp } from "../../src/api/index.js";
import { authMiddleware } from "../../src/lib/auth.js";
import { handleError } from "../../src/lib/http-errors.js";
import { payments } from "../../src/api/payments.js";
import { wallet } from "../../src/api/wallet.js";
import { tier } from "../../src/api/tier.js";
import { bonuses } from "../../src/api/bonuses.js";
import { referrals } from "../../src/api/referrals.js";
import { delivery } from "../../src/api/delivery.js";
import { emergency } from "../../src/api/emergency.js";

declare global {
  // eslint-disable-next-line no-var
  var __testApp__: Hono;
}

function setupTestApp(): void {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  // Inject auth user from x-dev-user header (mock auth)
  const mockAuth = async (c: any, next: any) => {
    const devUser = c.req.header("x-dev-user");
    if (!devUser) {
      c.set("user", null);
      return next();
    }
    const groups = (c.req.header("x-dev-groups") ?? "").split(",").filter(Boolean);
    c.set("user", {
      email: devUser,
      groups,
      deviceId: c.req.header("x-device-id"),
      ip: c.req.header("x-forwarded-for") ?? "127.0.0.1",
    });
    return next();
  };

  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.use("/v1/*", mockAuth);
  app.route("/v1/payments", payments);
  app.route("/v1/wallet", wallet);
  app.route("/v1/tier", tier);
  app.route("/v1/bonuses", bonuses);
  app.route("/v1/referrals", referrals);
  app.route("/v1/delivery", delivery);
  app.route("/v1/emergency", emergency);
  app.onError((err, c) => handleError(err, c));

  globalThis.__testApp__ = app;

  // Initialize app context with mock DDB client
  initApp({
    walletsTable: "wallets",
    ledgerTable: "ledger",
    transactionsTable: "transactions",
    referralsTable: "referrals",
    bonusesTable: "bonuses",
    ipGeoCacheTable: "ip_geo_cache",
    fraudSignalsTable: "fraud_signals",
    dynamoClient: { send: (...args: any[]) => ddbMock.send(...args as any) },
    wompiPublicKey: "pub_test_KEY",
    wompiIntegritySecret: "test_integrity_secret_xyz",
    wompiEventsSecret: "test_events_secret_abc",
    abortFlags: { paymentPaused: false, payoutsPaused: false },
  });
}

setupTestApp();