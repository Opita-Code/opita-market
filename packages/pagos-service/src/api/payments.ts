/**
 * Payments API routes.
 *
 * POST /v1/payments/intent          — create payment intent (idempotent)
 * POST /v1/payments/webhook         — Wompi webhook receiver
 * POST /v1/payments/:id/refund      — DPO-only refund
 * POST /v1/payments/:id/dispute     — buyer dispute
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { requireUser, requireDpo } from "../lib/auth.js";
import { verifyWebhookSignature, generateIntegritySignature } from "../lib/wompi.js";
import { processWompiWebhook } from "../lib/webhook-gateway/index.js";
import { FraudEngine } from "../lib/fraud.js";
import { TierLimitExceededError, InvalidSignatureError, AmountInvalidError, ChannelNotAllowedError, FraudBlockedError, InvalidStateError } from "../lib/errors.js";
import { TIERS, requires3DS, isValidTier, type Tier } from "../lib/tiers.js";
import { getAppContext, type AppContext } from "./index.js";

export const payments = new Hono();

const ALLOWED_CHANNELS = ["WOMPI_CARD", "WOMPI_BREB", "WOMPI_PSE", "WOMPI_NEQUI", "WOMPI_DAVIPLATA"];

// ─── POST /v1/payments/intent ────────────────────────────────────────────────

payments.post("/intent", async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));

  // Validate
  const amount = Number(body?.amount_cop);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AmountInvalidError("amount_cop must be a positive integer");
  }
  const channel = String(body?.channel ?? "");
  if (!ALLOWED_CHANNELS.includes(channel)) {
    throw new ChannelNotAllowedError(`Invalid channel: ${channel}`);
  }
  // SECURITY: Always derive sender from auth context, NEVER accept from body.
  // Closes OPL-API-003 — from_user_id override (IDOR / mass assignment).
  const fromUserId = user.email;
  const toUserId = String(body?.to_user_id ?? "");
  const productContext = body?.product_context;
  const idempotencyKey = String(body?.idempotency_key ?? "");

  if (!toUserId) throw new AmountInvalidError("to_user_id is required");
  if (!idempotencyKey) throw new AmountInvalidError("idempotency_key is required");

  const ctx = getAppContext();

  // Idempotency check
  const idempotencyKeyHash = Buffer.from(idempotencyKey).toString("base64url");
  const existing = await lookupByIdempotencyKey(ctx, idempotencyKeyHash);
  if (existing) {
    return c.json({
      transaction_id: existing.transaction_id,
      reference: existing.reference,
      amount_in_cents: existing.amount_cop,
      currency: "COP",
      public_key: ctx.wompiPublicKey,
      integrity_signature: existing.signature ?? "",
      requires_3ds: existing.requires_3ds ?? false,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  }

  // Tier check on the recipient
  const recipientWallet = await lookupWallet(ctx, toUserId);
  const recipientTier: Tier = isValidTier(recipientWallet?.tier) ? recipientWallet.tier : 0;
  const lifetimeReceived = recipientWallet?.lifetime_received_cop ?? 0;
  if (lifetimeReceived + amount > TIERS[recipientTier].receiveLimitDayCop) {
    throw new TierLimitExceededError(
      `Tier ${recipientTier} receive limit exceeded`,
      recipientTier,
      TIERS[recipientTier].receiveLimitDayCop,
      lifetimeReceived + amount,
    );
  }

  // Anti-fraud check
  const fraud = await runFraudChecks(ctx, user, fromUserId, toUserId, amount);
  if (fraud.decision === "BLOCK") {
    throw new FraudBlockedError(`Blocked: ${fraud.signals.map((s) => s.type).join(",")}`, fraud.signals);
  }

  // Create transaction
  const transactionId = `tx-${randomUUID()}`;
  const reference = `${productContext?.kind ?? "PAYMENT"}::${toUserId}::${Date.now()}`;
  const needs3DS = requires3DS(recipientTier, amount);
  const signature = generateIntegritySignature({
    reference,
    amountInCents: amount,
    currency: "COP",
    integritySecret: ctx.wompiIntegritySecret,
  });

  await ctx.dynamoClient.send(
    new PutCommand({
      TableName: ctx.transactionsTable,
      Item: {
        transaction_id: transactionId,
        intent: "PAYMENT",
        channel,
        status: "PENDING",
        amount_cop: amount,
        reference,
        idempotency_key: idempotencyKey,
        idempotency_key_hash: idempotencyKeyHash,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        product_context: productContext,
        escrow_state: "NONE",
        fraud_signals: fraud.signals.map((s) => s.type),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      },
    }),
  );

  return c.json({
    transaction_id: transactionId,
    reference,
    amount_in_cents: amount,
    currency: "COP",
    public_key: ctx.wompiPublicKey,
    integrity_signature: signature,
    requires_3ds: needs3DS,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
});

// ─── POST /v1/payments/webhook ──────────────────────────────────────────────

payments.post("/webhook", async (c) => {
  const ctx = getAppContext();

  // 1. Parse body (SyntaxError → 400 via global error handler)
  const body = await c.req.json();

  // 2. Verify Wompi signature (R1 of webhook-gateway spec)
  //    Generic InvalidSignatureError — no info leak
  if (!verifyWebhookSignature(body, ctx.wompiEventsSecret)) {
    throw new InvalidSignatureError();
  }

  // 3. Process via webhook gateway (handles timestamp, idempotency, state machine, 3DS)
  //    Closes: OPL-LIB-001 (replay), OPL-API-004 (idempotency), OPL-CARD-002 (state machine)
  //    Closes: OPL-CARD-004 (3DS), OPL-LIB-007 (generic errors), OPL-DEP-001 (no more 500s)
  const result = await processWompiWebhook(body, body?.signature?.checksum ?? "", {
    eventsSecret: ctx.wompiEventsSecret,
    maxAgeMs: 5 * 60 * 1000,
    replayStore: ctx.replayStore,
    escrowMachine: ctx.escrowMachine,
    threeDsVerifier: ctx.threeDsVerifier,
    wompiClient: ctx.wompiClient,
    transactCredit: ctx.transactCredit,
    transactTransition: ctx.transactTransition,
    transactReverseBonus: ctx.transactReverseBonus,
      resolveUserFromReference: async (ref) => (await ctx.resolveUserFromReference(ref)) ?? "",
  });

  return c.json({
    ok: result.ok,
    tx_id: result.txId,
    replay: result.replay,
    new_state: result.newState,
    ...(result.fraudSignal ? { fraud_signal: result.fraudSignal } : {}),
  });
});

// ─── POST /v1/payments/:id/refund (DPO-only) ─────────────────────────────────

payments.post("/:id/refund", async (c) => {
  requireDpo(c);
  const ctx = getAppContext();
  const txId = c.req.param("id");
  await c.req.json().catch(() => ({}));

  const tx = await lookupTransaction(ctx, txId);
  if (!tx) throw new InvalidStateError("Transaction not found");
  if (tx.status === "REFUNDED") throw new InvalidStateError("Already refunded");
  if (tx.status !== "APPROVED") throw new InvalidStateError("Cannot refund unapproved tx");

  await ctx.dynamoClient.send(
    new UpdateCommand({
      TableName: ctx.transactionsTable,
      Key: { transaction_id: txId },
      UpdateExpression: "SET #s = :refunded, updated_at = :now",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":refunded": "REFUNDED",
        ":now": new Date().toISOString(),
      },
    }),
  );

  // PR 6 simplified: PR 8 will call Wompi refund API + reverse bonuses
  return c.json({ refund_id: txId, status: "PROCESSING" });
});

// ─── POST /v1/payments/:id/dispute (buyer) ──────────────────────────────────

payments.post("/:id/dispute", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const txId = c.req.param("id");
  await c.req.json().catch(() => ({}));

  const tx = await lookupTransaction(ctx, txId);
  if (!tx) throw new InvalidStateError("Transaction not found");

  if (tx.status !== "RELEASED" || !tx.dispute_window_ends_at) {
    throw new InvalidStateError("Dispute only allowed for RELEASED tx within window");
  }
  if (new Date() > new Date(tx.dispute_window_ends_at)) {
    throw new InvalidStateError("Dispute window closed");
  }

  await ctx.dynamoClient.send(
    new UpdateCommand({
      TableName: ctx.transactionsTable,
      Key: { transaction_id: txId },
      UpdateExpression: "SET escrow_state = :disputed, updated_at = :now",
      ExpressionAttributeValues: {
        ":disputed": "DISPUTED",
        ":now": new Date().toISOString(),
      },
    }),
  );

  return c.json({
    dispute_id: txId,
    status: "OPEN",
    dpo_notified_at: new Date().toISOString(),
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function lookupByIdempotencyKey(ctx: AppContext, hash: string): Promise<any | null> {
  const result = await ctx.dynamoClient.send(
    new QueryCommand({
      TableName: ctx.transactionsTable,
      IndexName: "IdempotencyKeyIndex",
      KeyConditionExpression: "idempotency_key_hash = :h",
      ExpressionAttributeValues: { ":h": hash },
      Limit: 1,
    }),
  );
  return result.Items?.[0] ?? null;
}

async function lookupTransaction(ctx: AppContext, txId: string): Promise<any | null> {
  const result = await ctx.dynamoClient.send(
    new GetCommand({
      TableName: ctx.transactionsTable,
      Key: { transaction_id: txId },
    }),
  );
  return result.Item ?? null;
}

async function lookupWallet(ctx: AppContext, userId: string): Promise<any | null> {
  const result = await ctx.dynamoClient.send(
    new GetCommand({
      TableName: ctx.walletsTable,
      Key: { user_id: userId },
    }),
  );
  return result.Item ?? null;
}

async function runFraudChecks(
  ctx: AppContext,
  user: { ip?: string },
  _fromUserId: string,
  _toUserId: string,
  _amount: number,
): Promise<{ decision: "ALLOW" | "REVIEW" | "BLOCK"; signals: Array<{ type: string; weight: number }> }> {
  const ip = user.ip ?? "0.0.0.0";
  const geo = await ctx.dynamoClient.send(
    new GetCommand({
      TableName: ctx.ipGeoCacheTable,
      Key: { ip },
    }),
  ).then((r: any) => r.Item).catch(() => null);

  const engine = new FraudEngine();
  const signals = geo ? engine.evaluateSignals([
    ...(geo.is_tor ? [{ type: "TOR_EXIT" as const, weight: 1.0 }] : []),
    ...(geo.is_vpn ? [{ type: "VPN_DETECTED" as const, weight: 0.8 }] : []),
    ...(geo.is_proxy ? [{ type: "PROXY_DETECTED" as const, weight: 0.6 }] : []),
    ...(geo.is_datacenter ? [{ type: "DATACENTER_IP" as const, weight: 0.5 }] : []),
  ]) : engine.evaluateSignals([]);

  return signals;
}