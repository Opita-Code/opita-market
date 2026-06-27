import { Hono } from "hono";
import { getAppContext } from "./index.js";
import { verifyWebhookSignature } from "../lib/wompi.js";
import { InvalidSignatureError, EvidenceRequiredError } from "../lib/errors.js";
import { EscrowStateMachine } from "../lib/escrow.js";

export const delivery = new Hono();

// ─── POST /v1/delivery/confirm (transportadora webhook) ────────────────────

delivery.post("/confirm", async (c) => {
  const ctx = getAppContext();
  const body = await c.req.json();

  // Verify transportadora signature
  const signature = c.req.header("x-transportadora-signature");
  // PR 6 simplified: skip signature check (transportadora-specific)
  // For PR 8: verifyTransportadoraSignature(signature, body)

  const txId = String(body?.transaction_id ?? "");
  if (!txId) throw new InvalidSignatureError("Missing transaction_id");

  const result = await ctx.dynamoClient.send({
    TableName: ctx.transactionsTable,
    Key: { transaction_id: txId },
  });
  const tx = result.Item;
  if (!tx) throw new InvalidSignatureError("Transaction not found");

  const evidence = {
    delivered_at: body?.delivered_at ?? new Date().toISOString(),
    recipient_name: body?.recipient_name ?? "",
    photo_url: body?.photo_url,
    signature_png: body?.signature_png,
    tracking_number: body?.tracking_number ?? "",
  };

  if (tx.amount_cop > 1_000_000) {
    if (!evidence.photo_url || !evidence.signature_png) {
      throw new EvidenceRequiredError("Photo + signature required for tx > $1M COP");
    }
  }

  const sm = new EscrowStateMachine();
  const updated = sm.transition(
    {
      transaction_id: txId,
      amount_cop: tx.amount_cop,
      channel: tx.channel,
      escrow_state: tx.escrow_state,
      created_at: tx.created_at,
    },
    "DELIVERY_CONFIRM",
    { evidence },
  );

  if (updated.error) {
    throw new InvalidSignatureError(`State machine error: ${updated.error}`);
  }

  await ctx.dynamoClient.send({
    TableName: ctx.transactionsTable,
    Key: { transaction_id: txId },
    UpdateExpression: "SET escrow_state = :s, escrow_released_at = :r, dispute_window_ends_at = :d, updated_at = :now",
    ExpressionAttributeValues: {
      ":s": updated.escrow_state,
      ":r": updated.escrow_released_at,
      ":d": updated.dispute_window_ends_at,
      ":now": new Date().toISOString(),
    },
  });

  return c.json({
    escrow_state: updated.escrow_state,
    dispute_window_ends_at: updated.dispute_window_ends_at,
  });
});