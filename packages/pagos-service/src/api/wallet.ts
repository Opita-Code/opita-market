import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCommand, UpdateCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { requireUser } from "../lib/auth.js";
import { InvalidStateError, InsufficientBalanceError, AmountInvalidError, WithdrawHoldNotElapsedError, TierLimitExceededError } from "../lib/errors.js";
import { getAppContext } from "./index.js";
import { TIERS, withdrawHoldFor, isValidTier, type Tier } from "../lib/tiers.js";
import { transactP2PTransfer } from "../lib/transact/index.js";
import { randomUUID } from "node:crypto";

export const wallet = new Hono();

// ─── GET /v1/wallet/:user/balance ───────────────────────────────────────────

wallet.get("/:user/balance", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email && !user.groups.includes("dpo")) {
    throw new InvalidStateError("Cannot view another user's balance");
  }

  const result = await ctx.dynamoClient.send(
    new GetCommand({
      TableName: ctx.walletsTable,
      Key: { user_id: targetUser },
    }),
  );

  const item = result.Item;
  if (!item) {
    return c.json({
      user_id: targetUser,
      balance_cop: 0,
      tier: 0,
      kyc_state: "INCOMPLETE",
      trust_badge: null,
      receive_limit_day_cop: TIERS[0].receiveLimitDayCop,
      withdraw_limit_day_cop: TIERS[0].withdrawLimitDayCop,
      withdraw_hold_hours: TIERS[0].withdrawHoldHours,
      updated_at: new Date().toISOString(),
    });
  }

  const rawTier = item.tier;
  const tier: Tier = isValidTier(rawTier) ? rawTier : 0;
  const cfg = TIERS[tier];

  return c.json({
    user_id: targetUser,
    balance_cop: item.balance_cop ?? 0,
    tier,
    kyc_state: item.kyc_state,
    trust_badge: cfg.badge,
    receive_limit_day_cop: cfg.receiveLimitDayCop,
    receive_limit_day_used_cop: item.lifetime_received_cop ?? 0,
    receive_limit_day_remaining_cop: Math.max(0, cfg.receiveLimitDayCop - (item.lifetime_received_cop ?? 0)),
    withdraw_limit_day_cop: cfg.withdrawLimitDayCop,
    withdraw_hold_hours: cfg.withdrawHoldHours,
    updated_at: item.updated_at ?? new Date().toISOString(),
  });
});

// ─── POST /v1/wallet/:user/topup ────────────────────────────────────────────

wallet.post("/:user/topup", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email) throw new InvalidStateError("Cannot topup another user");
  const body = await c.req.json().catch(() => ({}));
  return c.json({
    transaction_id: `tx-${randomUUID()}`,
    reference: `TOPUP::${targetUser}::${Date.now()}`,
    amount_in_cents: body?.amount_cop ?? 0,
    currency: "COP",
    public_key: ctx.wompiPublicKey,
    note: "Use POST /v1/payments/intent for full intent creation",
  });
});

// ─── POST /v1/wallet/:user/withdraw ────────────────────────────────────────

wallet.post("/:user/withdraw", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email) throw new InvalidStateError("Cannot withdraw for another user");

  const body = await c.req.json();
  const amount = Number(body?.amount_cop);
  const phone = String(body?.destination?.phone ?? "");

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AmountInvalidError("amount_cop must be a positive integer");
  }
  if (!phone) throw new AmountInvalidError("destination.phone is required");

  const result = await ctx.dynamoClient.send(
    new GetCommand({
      TableName: ctx.walletsTable,
      Key: { user_id: targetUser },
    }),
  );
  const w = result.Item;
  const balance = w?.balance_cop ?? 0;
  const rawTier = w?.tier;
  const tier: Tier = isValidTier(rawTier) ? rawTier : 0;
  const lifetimeWithdrawn = w?.lifetime_withdrawn_cop ?? 0;

  if (balance < amount) {
    throw new InsufficientBalanceError(`Insufficient balance: ${balance} < ${amount}`, balance, amount);
  }

  const tierConfig = TIERS[tier];
  if (lifetimeWithdrawn + amount > tierConfig.withdrawLimitDayCop) {
    throw new TierLimitExceededError(
      `Tier ${tier} withdraw limit exceeded`,
      tier,
      tierConfig.withdrawLimitDayCop,
      lifetimeWithdrawn + amount,
    );
  }

  const holdHours = withdrawHoldFor(tier, amount);
  if (holdHours > 0) {
    const availableAt = new Date(Date.now() + holdHours * 60 * 60 * 1000).toISOString();
    throw new WithdrawHoldNotElapsedError(
      `Hold not elapsed; available at ${availableAt}`,
      availableAt,
      holdHours,
    );
  }

  if (ctx.abortFlags.payoutsPaused) {
    throw new InvalidStateError("Payouts are paused (emergency kill-switch active)");
  }

  // PR 2.x: use transactDebitWallet from PR 1.2 (closes OPL-API-011 race + OPL-LIB-002 TOCTOU)
  return c.json({
    withdrawal_id: `wd-${randomUUID()}`,
    status: "PROCESSING",
    available_at: new Date().toISOString(),
  });
});

// ─── POST /v1/wallet/:user/transfer (P2P) ──────────────────────────────────

wallet.post("/:user/transfer", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const fromUserId = c.req.param("user");
  if (fromUserId !== user.email) throw new InvalidStateError("Cannot transfer from another user");

  const body = await c.req.json();
  const toUserId = String(body?.to_user_id ?? "");
  const amount = Number(body?.amount_cop);

  if (!toUserId) throw new AmountInvalidError("to_user_id is required");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AmountInvalidError("amount_cop must be a positive integer");
  }

  // PR 2a — atomic P2P transfer via TransactWriteItems
  // Closes: OPL-API-001, OPL-CARD-003 (funds-loss prevention)
  // Both legs succeed or both fail. No TOCTOU race.
  const baseClient = new DynamoDBClient({});
  await transactP2PTransfer(
    {
      fromUserId,
      toUserId,
      amountCop: amount,
      idempotencyKey: `${fromUserId}:${toUserId}:${Date.now()}:${randomUUID().slice(0, 8)}`,
    },
    { client: baseClient as any },
  );

  const ts = new Date().toISOString();
  const txId = `tx-${randomUUID()}`;
  for (const [u, m, a] of [
    [fromUserId, "TRANSFER_OUT", -amount],
    [toUserId, "TRANSFER_IN", amount],
  ] as const) {
    await ctx.dynamoClient.send(
      new PutCommand({
        TableName: ctx.ledgerTable,
        Item: {
          user_id: u,
          ts_seq: `${ts}#${randomUUID().slice(0, 6)}`,
          movement: m,
          amount_cop: a,
          balance_after_cop: 0,
          transaction_id: txId,
          created_at: ts,
        },
      }),
    );
  }

  return c.json({ transfer_id: txId, status: "COMPLETED" });
});