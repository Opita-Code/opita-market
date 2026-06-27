/**
 * PagosAPI — Hono application factory + Lambda handler.
 *
 * All routes are mounted under `/v1/...`. Auth is applied globally.
 * Errors are mapped via http-errors.ts.
 */

import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { authMiddleware } from "../lib/auth.js";
import { handleError } from "../lib/http-errors.js";
import { payments } from "./payments.js";
import { wallet } from "./wallet.js";
import { tier } from "./tier.js";
import { bonuses } from "./bonuses.js";
import { referrals } from "./referrals.js";
import { delivery } from "./delivery.js";
import { emergency } from "./emergency.js";

/** Module-level singletons (initialized by initApp). */
export interface AppContext {
  walletsTable: string;
  ledgerTable: string;
  transactionsTable: string;
  referralsTable: string;
  bonusesTable: string;
  ipGeoCacheTable: string;
  fraudSignalsTable: string;
  dynamoClient: any;
  wompiPublicKey: string;
  wompiIntegritySecret: string;
  wompiEventsSecret: string;
  abortFlags: { paymentPaused: boolean; payoutsPaused: boolean };
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

  // Health endpoint (no auth)
  app.get("/health", (c) => c.json({ status: "ok", service: "pagos", ts: new Date().toISOString() }));

  // Auth middleware for everything else
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
let _cachedHandler: any = null;
export const handler = async (event: any, context: any) => {
  if (!_cachedHandler) {
    const app = createApp();
    _cachedHandler = handle(app);
  }
  return _cachedHandler(event, context);
};