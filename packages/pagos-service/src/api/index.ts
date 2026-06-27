/**
 * PagosAPI — Hono application factory + Lambda handler.
 *
 * All routes are mounted under `/v1/...`. Auth is applied globally.
 * Errors are mapped via http-errors.ts.
 *
 * SST v4 binding pattern (mirrors packages/compliance-service/src/api/index.ts):
 *   - Resources are bound via `link: [Resource.X, ...]` in sst.config.ts
 *   - Resources are accessed at runtime via `Resource.X.value` / `Resource.X.name`
 *   - We resolve them on first invocation and cache the app
 */

import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource as SSTResource } from "sst";
import { authMiddleware } from "../lib/auth.js";
import { handleError } from "../lib/http-errors.js";
import { DynamoReplayStore } from "../lib/replay-store/dynamo.js";
import { payments } from "./payments.js";
import { wallet } from "./wallet.js";
import { tier } from "./tier.js";
import { bonuses } from "./bonuses.js";
import { referrals } from "./referrals.js";
import { delivery } from "./delivery.js";
import { emergency } from "./emergency.js";

/** Module-level singletons (initialized by initApp). */
import type { ReplayStore } from "../lib/replay-store/index.js";
import type {
  EscrowMachine,
  ThreeDsVerifier,
  WompiClient,
  CreditInput,
  CreditResult,
  EscrowTransitionInput,
  EscrowTransitionResult,
  ReverseBonusInput,
} from "../lib/webhook-gateway/index.js";

export interface AppContext {
  walletsTable: string;
  ledgerTable: string;
  transactionsTable: string;
  referralsTable: string;
  bonusesTable: string;
  ipGeoCacheTable: string;
  fraudSignalsTable: string;
  processedWebhooksTable: string;
  dynamoClient: DynamoDBDocumentClient;
  wompiPublicKey: string;
  wompiIntegritySecret: string;
  wompiEventsSecret: string;
  abortFlags: { paymentPaused: boolean; payoutsPaused: boolean };
  jwtSecret: string;
  featureFlags: {
    authGatewayEnabled: boolean;
    webhookGatewayEnabled: boolean;
    transactEnabled: boolean;
  };
  // Webhook gateway deps (PR 1.4c — Option C)
  replayStore: ReplayStore;
  escrowMachine: EscrowMachine;
  threeDsVerifier: ThreeDsVerifier;
  wompiClient: WompiClient;
  transactCredit: (input: CreditInput) => Promise<CreditResult>;
  transactTransition: (input: EscrowTransitionInput) => Promise<EscrowTransitionResult>;
  transactReverseBonus: (input: ReverseBonusInput) => Promise<void>;
  resolveUserFromReference: (reference: string) => Promise<string | null>;
}

let appContext: AppContext | null = null;

export function initApp(ctx: AppContext): void {
  appContext = ctx;
}

export function getAppContext(): AppContext {
  if (!appContext) throw new Error("AppContext not initialized — call initApp() first");
  return appContext;
}

export function createApp(): Hono {
  const app = new Hono();

  // Health endpoint (no auth) — minimal info, no service name leak
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Auth middleware for everything else (R6: auth gateway)
  app.use("/v1/*", authMiddleware);

  // Mount route modules
  app.route("/v1/payments", payments);
  app.route("/v1/wallet", wallet);
  app.route("/v1/tier", tier);
  app.route("/v1/bonuses", bonuses);
  app.route("/v1/referrals", referrals);
  app.route("/v1/delivery", delivery);
  app.route("/v1/emergency", emergency);

  // Global error handler
  app.onError((err, c) => handleError(err, c));

  return app;
}

/** AWS Lambda entry point — called by SST. */
let _cachedHandler: ReturnType<typeof handle> | null = null;
export const handler = async (event: unknown, context: unknown): Promise<unknown> => {
  if (!_cachedHandler) {
    // Resolve SST-linked resources on first invocation.
    // In sst dev, Resource values come from the local simulator.
    // In sst deploy, Resource values come from AWS (Secrets Manager + DDB).
    type LinkedResources = {
      WalletsTable: { name: string };
      LedgerTable: { name: string };
      TransactionsTable: { name: string };
      ReferralsTable: { name: string };
      BonusesTable: { name: string };
      IpGeoCacheTable: { name: string };
      FraudSignalsTable: { name: string };
      ProcessedWebhooksTable: { name: string };
      WompiPublicKey: { value: string };
      WompiPrivateKey: { value: string };
      WompiEventsSecret: { value: string };
      WompiIntegritySecret: { value: string };
      ComplianceJwtSecret: { value: string };
    };
    const Res = SSTResource as unknown as LinkedResources;

    const baseClient = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(baseClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    initApp({
      walletsTable: Res.WalletsTable.name,
      ledgerTable: Res.LedgerTable.name,
      transactionsTable: Res.TransactionsTable.name,
      referralsTable: Res.ReferralsTable.name,
      bonusesTable: Res.BonusesTable.name,
      ipGeoCacheTable: Res.IpGeoCacheTable.name,
      fraudSignalsTable: Res.FraudSignalsTable.name,
      processedWebhooksTable: Res.ProcessedWebhooksTable.name,
      dynamoClient: docClient,
      wompiPublicKey: Res.WompiPublicKey.value,
      wompiIntegritySecret: Res.WompiIntegritySecret.value,
      wompiEventsSecret: Res.WompiEventsSecret.value,
      abortFlags: { paymentPaused: false, payoutsPaused: false },
      jwtSecret: Res.ComplianceJwtSecret.value,
      featureFlags: {
        // Feature flags for safe rollback (R-014 of pre-deploy-remediation)
        authGatewayEnabled: process.env.AUTH_GATEWAY_ENABLED === "true",
        webhookGatewayEnabled: process.env.WEBHOOK_GATEWAY_ENABLED === "true",
        transactEnabled: process.env.TRANSACT_ENABLED === "true",
      },
      // Webhook gateway deps (PR 1.4c — Option C integration)
      replayStore: new DynamoReplayStore(docClient, Res.ProcessedWebhooksTable.name),
      // Placeholder no-op implementations for state machine + 3DS + transact
      // (will be replaced with real implementations in PR 1.4c proper,
      //  once bonus/escrow/wallet modules are integrated)
      escrowMachine: {
        async transition(_txId, _event) {
          // PR 1.4c proper: use transactEscrowTransition from PR 1.2
          return { txId: _txId, newState: "HELD" };
        },
      },
      threeDsVerifier: {
        async verify(_wompiTxId) {
          // PR 1.4c proper: call Wompi API
          return { authenticated: true, authenticationValue: "stub" };
        },
      },
      wompiClient: {
        async getTransaction(_id) {
          // PR 1.4c proper: call Wompi API
          return { id: _id, status: "APPROVED", payment_method: { extra: {} } };
        },
      },
      transactCredit: async () => {
        // PR 1.4c proper: use transactDebitWallet
        throw new Error("transactCredit not yet wired — see PR 1.4c proper");
      },
      transactTransition: async (input) => {
        // PR 1.4c proper: use transactEscrowTransition
        return { txId: input.txId, fromState: input.fromState, toState: input.toState, version: 1 };
      },
      transactReverseBonus: async () => {
        // PR 1.4c proper: wire to bonus engine
        // For now this is a no-op (the webhook handler logs fraud signal if
        // 3DS fails, but doesn't actually credit/refund until full integration)
      },
      resolveUserFromReference: async (_reference) => {
        // PR 1.4c proper: lookup transactions table by reference
        // For now: return null (no credit happens — webhook logs and returns ok)
        return null;
      },
    });

    const app = createApp();
    _cachedHandler = handle(app);
  }
  return _cachedHandler(event as Parameters<typeof _cachedHandler>[0], context as Parameters<typeof _cachedHandler>[1]);
};
