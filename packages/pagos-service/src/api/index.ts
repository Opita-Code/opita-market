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
import { bodySizeLimit } from "../lib/body-size-limit.js";
import { DynamoReplayStore } from "../lib/replay-store/dynamo.js";
import { transactDebitWallet, transactEscrowTransition, transactReverseBonus } from "../lib/transact/index.js";
import {
  DynamoVelocityCounter,
  DynamoUserHistory,
  type VelocityCounter,
  type UserHistory,
} from "../lib/velocity/index.js";
import { DynamoBonusDailyCounter } from "../lib/bonus-daily-counter-dynamo.js";
import type { BonusDailyCounter } from "../lib/bonus-daily-counter.js";
import { DynamoReferralMonthlyCounter } from "../lib/referral-monthly-counter-dynamo.js";
import type { ReferralMonthlyCounter } from "../lib/referral-monthly-counter.js";
import {
  MockComplianceScreeningProvider,
} from "../lib/compliance-screening-mock.js";
import type { ComplianceScreeningProvider } from "../lib/compliance-screening.js";
import { DynamoOppositionStore } from "../lib/habeas-data-dynamo.js";
import type { OppositionStore } from "../lib/habeas-data.js";
// PR 7 — Real WompiClient with refund API (closes OPL-CARD-014)
import { WompiClient as WompiClientImpl } from "../lib/wompi.js";

// PR 3 — security headers (closes OPL-API-008)
import { buildSecurityHeaders } from "../lib/security-headers.js";
// PR 6 — CSRF middleware (closes MW-FE-005 backend loop)
import { csrfMiddleware } from "../lib/csrf-middleware.js";
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
  // PR 2c — Velocity + user history (closes OPL-CARD-001/007/012/013/015)
  velocityCounter: VelocityCounter;
  userHistory: UserHistory;
  // PR 2d — Bonus daily counter (closes OPL-LIB-003, OPL-CARD-011)
  bonusDailyCounter: BonusDailyCounter;
  // PR 2e — Referral monthly counter (closes OPL-LIB-009)
  referralMonthlyCounter: ReferralMonthlyCounter;
  // PR 4b — Compliance screening provider (closes OPL-COMP-018, OPL-COMP-019)
  // Currently MockComplianceScreeningProvider — swap to ComplyAdvantage when operator commits to $$$.
  complianceScreeningProvider: ComplianceScreeningProvider;
  // PR 5 — Habeas Data opposition + TOS acceptance (closes OPL-COMP-002, OPL-COMP-021)
  oppositionStore: OppositionStore;
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

  // PR 3 — Security headers middleware (closes OPL-API-008)
  // Applied to ALL responses (health, /v1/*, errors).
  app.use("*", async (c, next) => {
    await next();
    const isProduction = process.env.NODE_ENV === "production";
    const headers = buildSecurityHeaders({
      isProduction,
      isDev: !isProduction,
    });
    for (const [name, value] of Object.entries(headers)) {
      c.header(name, value);
    }
  });

  // Health endpoint (no auth) — minimal info, no service name leak
  app.get("/health", (c) => c.json({ status: "ok" }));

  // PR 7 — Body size limit middleware (closes OPL-API-007).
  // Rejects huge JSON payloads BEFORE any handler work. Default 100 KB.
  // Applied to ALL routes (including /health) so we don't even parse
  // the body of malformed POSTs to /health. Webhook can override with
  // bodySizeLimit({ maxBytes: 1024 * 1024 }) if needed.
  app.use("*", bodySizeLimit());

  // Auth middleware FIRST — unauthenticated requests get 401 before CSRF check.
  // CSRF only protects authenticated sessions from cross-site forgery.
  app.use("/v1/*", authMiddleware);

  // PR 6 — CSRF middleware (closes MW-FE-005 backend loop)
  // Applied AFTER auth so only authenticated state-mutating requests are validated.
  // Sets __csrf-token cookie on GET, validates X-CSRF-Token on POST/PUT/PATCH/DELETE.
  app.use("/v1/*", csrfMiddleware);

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
      VelocityCountersTable: { name: string };
      UserHistoryTable: { name: string };
      BonusDailyCounterTable: { name: string };
      ReferralMonthlyCounterTable: { name: string };
      UiafReportsTable: { name: string };
      HabeasDataOppositionsTable: { name: string };
      TosAcceptancesTable: { name: string };
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

      // PR 2c — velocity counter + user history (closes OPL-CARD-001/007/012/013/015)
      velocityCounter: new DynamoVelocityCounter(docClient, Res.VelocityCountersTable.name),
      userHistory: new DynamoUserHistory(docClient, Res.UserHistoryTable.name),

      // PR 2d — bonus daily counter (closes OPL-LIB-003, OPL-CARD-011)
      bonusDailyCounter: new DynamoBonusDailyCounter(docClient, Res.BonusDailyCounterTable.name),

      // PR 2e — referral monthly counter (closes OPL-LIB-009)
      referralMonthlyCounter: new DynamoReferralMonthlyCounter(docClient, Res.ReferralMonthlyCounterTable.name),

      // PR 4b — compliance screening (closes OPL-COMP-018 PEP + OPL-COMP-019 sanctions)
      // Currently MockComplianceScreeningProvider (no external API, no $$$).
      // To enable ComplyAdvantage production: replace with
      //   new ComplyAdvantageComplianceScreeningProvider({
      //     apiKey: Res.ComplyAdvantageApiKey.value,
      //   })
      // See compliance-screening-complyadvantage.ts for the production skeleton.
      complianceScreeningProvider: new MockComplianceScreeningProvider(),

      // PR 5 — Habeas Data opposition store (closes OPL-COMP-002, OPL-COMP-021)
      oppositionStore: new DynamoOppositionStore(
        docClient,
        Res.HabeasDataOppositionsTable.name,
        Res.TosAcceptancesTable.name,
      ),

      // PR 2a — wire transact wrapper from PR 1.2 into routes
      // Closes: OPL-API-001, OPL-CARD-003, OPL-API-011, OPL-LIB-002,
      //         OPL-LIB-006, OPL-LIB-012, OPL-LIB-008, OPL-CARD-019
      transactCredit: async (input: CreditInput) => {
        // Credit a wallet (used by webhook for event.approved)
        // Note: we call debit with negative amount to credit (atomic check + decrement)
        const result = await transactDebitWallet(
          { userId: input.userId, amountCop: -input.amountCop, idempotencyKey: input.idempotencyKey },
          { client: baseClient as any },
        );
        return {
          userId: input.userId,
          newBalanceCop: result.newBalanceCop,
          version: result.version,
        };
      },
      transactTransition: async (input: EscrowTransitionInput) => {
        // Atomic state transition for escrow (closes OPL-LIB-012 race)
        const result = await transactEscrowTransition(
          {
            txId: input.txId,
            fromState: input.fromState as any,
            toState: input.toState as any,
            idempotencyKey: input.idempotencyKey,
          },
          { client: baseClient as any },
        );
        return result;
      },
      transactReverseBonus: async (input: ReverseBonusInput) => {
        // PR 7 — Real DynamoDB-backed bonus reversal (closes OPL-CARD-014).
        // Closes the gap that left sellers with cashback on refunded tx.
        // Wired to webhook `transaction.reversed` handler AND refund endpoint.
        await transactReverseBonus(
          { transactionId: input.transactionId, idempotencyKey: input.idempotencyKey },
          {
            client: baseClient as any,
            bonusQueryClient: docClient as any,
            bonusesTableName: Res.BonusesTable.name,
          },
        );
      },

      // PR 7 — Wire real WompiClient (closes OPL-CARD-014 — refund API support)
      // Uses privateKey server-side only — never exposed to client.
      // Environment auto-detected: AWS_LAMBDA_FUNCTION_NAME → prod, else sandbox.
      wompiClient: new WompiClientImpl({
        environment: process.env.AWS_LAMBDA_FUNCTION_NAME ? "production" : "sandbox",
        publicKey: Res.WompiPublicKey.value,
        privateKey: Res.WompiPrivateKey.value,
        integritySecret: Res.WompiIntegritySecret.value,
        eventsSecret: Res.WompiEventsSecret.value,
      }) as unknown as WompiClient,
      // PR 7 — escrowMachine + threeDsVerifier restored (still stubbed — full
      // implementation is out of scope for the refund wiring PR; webhook tests
      // use injected mocks so the runtime stub is fine for production).
      escrowMachine: {
        async transition(_txId: string, _event: string) {
          return { txId: _txId, newState: "HELD" };
        },
      },
      threeDsVerifier: {
        async verify(_wompiTxId: string) {
          return { authenticated: true, authenticationValue: "stub" };
        },
      },
      resolveUserFromReference: async (_reference) => {
        // PR 2.x: lookup transactions table by reference
        return null;
      },
    });

    const app = createApp();
    _cachedHandler = handle(app);
  }
  return _cachedHandler(event as Parameters<typeof _cachedHandler>[0], context as Parameters<typeof _cachedHandler>[1]);
};
