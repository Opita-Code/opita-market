import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getAppContext } from "./index.js";
import { InvalidSignatureError, EvidenceRequiredError } from "../lib/errors.js";
import { EscrowStateMachine } from "../lib/escrow.js";
import { transactEscrowTransition } from "../lib/transact/index.js";

export const delivery = new Hono();

// ─── POST /v1/delivery/confirm (transportadora webhook) ────────────────────
//
// SECURITY-CRITICAL — closes:
//   OPL-API-002 — transportadora signature verification (HMAC) — pending
//   OPL-LIB-004 — photo_url SSRF validation (https only, no private IPs) — pending
//
// PR 1.4c: fixes pre-existing BatchExecuteStatementCommand bug (replaced
//   with GetCommand + UpdateCommand — proper DynamoDB Document Client usage).
//   Full transportadora HMAC + SSRF validation lands in PR 1.4c proper
//   when the EscrowStateMachine is wired to the transact wrapper.

delivery.post("/confirm", async (c) => {
  const ctx = getAppContext();
  const body = await c.req.json();

  // Verify transportadora signature
  // PR 6 simplified: skip signature check (transportadora-specific)
  // PR 1.4c proper: verifyTransportadoraSignature(signature, body)
  const signature = c.req.header("x-transportadora-signature");
  void signature; // reserved for PR 1.4c proper

  const txId = String(body?.transaction_id ?? "");
  if (!txId) throw new InvalidSignatureError("Missing transaction_id");

  // Read transaction (use GetCommand, not inline — closes pre-existing TS2353)
  const result = await ctx.dynamoClient.send(
    new GetCommand({
      TableName: ctx.transactionsTable,
      Key: { transaction_id: txId },
    }),
  );
  const tx = result.Item;
  if (!tx) throw new InvalidSignatureError("Transaction not found");

  const evidence = {
    delivered_at: body?.delivered_at ?? new Date().toISOString(),
    recipient_name: body?.recipient_name ?? "",
    photo_url: body?.photo_url,
    signature_png: body?.signature_png,
    tracking_number: body?.tracking_number ?? "",
  };

  // PR 1.4c proper: SSRF validation on photo_url (https only, block 169.254.x.x, 127.x, 10.x)
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

  // PR 2b — atomic state transition via TransactWriteItems (closes OPL-LIB-012 race)
  // Prevents concurrent DELIVERY_CONFIRM + DISPUTE from both succeeding.
  // We use the OLD escrow_state (the read we just did) in the condition.
  const baseClient = new DynamoDBClient({});
  try {
    await transactEscrowTransition(
      {
        txId,
        fromState: tx.escrow_state ?? "NONE",
        toState: (updated.escrow_state as any) ?? "RELEASED",
        idempotencyKey: `delivery:${txId}:${Date.now()}`,
      },
      { client: baseClient as any },
    );
  } catch (err) {
    if ((err as { code?: string }).code === "CONDITION_FAILED") {
      // Concurrent state transition (e.g., dispute won) — operation rejected atomically.
      throw new InvalidSignatureError("State conflict: transaction moved to a different state");
    }
    throw err;
  }

  return c.json({
    escrow_state: updated.escrow_state,
    dispute_window_ends_at: updated.dispute_window_ends_at,
  });
});