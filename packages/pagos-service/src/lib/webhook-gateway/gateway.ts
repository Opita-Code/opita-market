/**
 * Webhook gateway — verification, idempotency, event dispatch.
 *
 * R1 — HMAC signature verification (uses existing wompi.ts internally)
 * R2 — Timestamp freshness check (closes OPL-LIB-001)
 * R3 — Idempotency via ProcessedWebhooks (closes OPL-API-004)
 * R4 — Event type dispatch (closes OPL-CARD-002)
 * R5 — 3DS verification (closes OPL-CARD-004)
 * R6 — Transportadora HMAC (TODO: PR follow-up)
 * R7 — Body size limit (TODO: Hono config)
 */

import { WebhookExpiredError, FraudSignalError } from "./errors.js";
import {
  DEFAULT_MAX_AGE_MS,
  ESCROW_EVENT_MAP,
  FRAUD_SIGNAL_3DS_NOT_VERIFIED,
  defaultEventId,
  type WompiEvent,
  type WebhookResult,
  type WebhookGatewayDeps,
} from "./types.js";

/**
 * R2 — verify timestamp is within maxAgeMs of now.
 * Closes OPL-LIB-001 (replay attack).
 */
export function verifyTimestamp(
  timestampMs: number,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): void {
  const now = Date.now();
  const skew = Math.abs(now - timestampMs);
  if (skew > maxAgeMs) {
    throw new WebhookExpiredError();
  }
}

/**
 * Main entry point — process a Wompi webhook event.
 *
 * Flow:
 *   1. Verify timestamp freshness (R2)
 *   2. Derive event_id (default: transaction_id + event_type)
 *   3. Check idempotency (R3)
 *   4. Dispatch by event type (R4)
 *   5. Mark processed (R3)
 *
 * Signature verification is done by the caller (Hono handler) using the
 * existing verifyWebhookSignature in src/lib/wompi.ts. The gateway only
 * orchestrates the post-signature logic.
 */
export async function processWompiWebhook(
  event: WompiEvent,
  _signature: string, // signature already verified by caller
  deps: WebhookGatewayDeps,
): Promise<WebhookResult> {
  // R2: timestamp freshness (Wompi sends Unix seconds, convert to ms)
  const timestampMs = event.timestamp * 1000;
  verifyTimestamp(timestampMs, deps.maxAgeMs);

  // R3: idempotency
  const eventId = deps.deriveEventId ? deps.deriveEventId(event) : defaultEventId(event);
  if (await deps.replayStore.isProcessed(eventId)) {
    return { ok: true, txId: event.data.transaction.id, replay: true };
  }

  const txId = event.data.transaction.id;
  const result = await dispatchEvent(event, txId, deps);

  // R3: mark processed AFTER successful dispatch
  await deps.replayStore.markProcessed(eventId, txId);

  return { ok: true, txId, newState: result.newState, ...(result.fraudSignal ? { fraudSignal: result.fraudSignal } : {}) };
}

async function dispatchEvent(
  event: WompiEvent,
  txId: string,
  deps: WebhookGatewayDeps,
): Promise<{ newState?: string; fraudSignal?: string }> {
  const eventType = event.event;
  const escrowEvent = ESCROW_EVENT_MAP[eventType];

  switch (eventType) {
    case "transaction.approved":
      return handleApproved(event, txId, deps, escrowEvent);
    case "transaction.declined":
      return handleDeclined(txId, deps, escrowEvent);
    case "transaction.reversed":
      return handleReversed(txId, deps, escrowEvent);
    case "transaction.disputed":
      return handleDisputed(txId, deps, escrowEvent);
    case "transaction.voided":
      // Closes OPL-API-015 — voided transactions (cancelled before capture)
      // terminate the flow. No reversal needed since no wallet credit.
      return handleVoided(txId, deps, escrowEvent);
    case "transaction.error":
      // Closes OPL-API-015 — error events flag the tx as ERROR for DPO
      // review. Wompi may retry; idempotency guards re-dispatch.
      return handleError(txId, deps, escrowEvent);
    default:
      // Unknown event type — log and ack to prevent Wompi retry
      return { newState: "UNKNOWN_EVENT" };
  }
}

async function handleApproved(
  event: WompiEvent,
  txId: string,
  deps: WebhookGatewayDeps,
  escrowEvent: string,
): Promise<{ newState: string; fraudSignal?: string }> {
  const tx = event.data.transaction;

  // R5: 3DS verification if required
  if (tx.requires_3ds) {
    const threeDs = await deps.threeDsVerifier.verify(tx.id);
    if (!threeDs.authenticated) {
      // 3DS not verified — return 200 to avoid retry, but signal fraud
      await deps.transactTransition({
        txId,
        fromState: "PENDING_3DS",
        toState: "FAILED",
        idempotencyKey: `${txId}:3DS_FAIL`,
      });
      return { newState: "FAILED", fraudSignal: FRAUD_SIGNAL_3DS_NOT_VERIFIED };
    }
  }

  // Transition escrow state
  const transition = await deps.transactTransition({
    txId,
    fromState: "NONE",
    toState: "HELD",
    idempotencyKey: `${txId}:${escrowEvent}`,
  });

  // Credit wallet (if user can be resolved)
  if (deps.resolveUserFromReference) {
    const userId = await deps.resolveUserFromReference(tx.reference);
    if (userId) {
      await deps.transactCredit({
        userId,
        amountCop: tx.amount_in_cents,
        idempotencyKey: `${txId}:CREDIT`,
      });
    }
  }

  return { newState: transition.toState };
}

async function handleDeclined(
  txId: string,
  deps: WebhookGatewayDeps,
  escrowEvent: string,
): Promise<{ newState: string }> {
  const transition = await deps.transactTransition({
    txId,
    fromState: "PENDING",
    toState: "FAILED",
    idempotencyKey: `${txId}:${escrowEvent}`,
  });
  return { newState: transition.toState };
}

async function handleReversed(
  txId: string,
  deps: WebhookGatewayDeps,
  escrowEvent: string,
): Promise<{ newState: string }> {
  await deps.transactReverseBonus({
    transactionId: txId,
    idempotencyKey: `${txId}:${escrowEvent}:REVERSE_BONUS`,
  });
  const transition = await deps.transactTransition({
    txId,
    fromState: "HELD",
    toState: "REFUNDED",
    idempotencyKey: `${txId}:${escrowEvent}`,
  });
  return { newState: transition.toState };
}

async function handleDisputed(
  txId: string,
  deps: WebhookGatewayDeps,
  escrowEvent: string,
): Promise<{ newState: string }> {
  const transition = await deps.transactTransition({
    txId,
    fromState: "HELD",
    toState: "DISPUTED",
    idempotencyKey: `${txId}:${escrowEvent}`,
  });
  return { newState: transition.toState };
}

/**
 * Closes OPL-API-015 (INFO) — `transaction.voided` event disposition.
 * Voided = cancelled before capture (Wompi-side, e.g. fraud block at the
 * gateway). The merchant never sees a credit, so we simply mark the
 * transaction as FAILED to release any PENDING_3DS lock.
 */
async function handleVoided(
  txId: string,
  deps: WebhookGatewayDeps,
  escrowEvent: string,
): Promise<{ newState: string }> {
  const transition = await deps.transactTransition({
    txId,
    fromState: "PENDING",
    toState: "FAILED",
    idempotencyKey: `${txId}:${escrowEvent}`,
  });
  return { newState: transition.toState };
}

/**
 * Closes OPL-API-015 (INFO) — `transaction.error` event disposition.
 * Error = Wompi-side processing error (network blip, internal timeout).
 * Mark the tx as ERROR so the reconciliation cron + DPO can re-drive it
 * (the cron polls Wompi 24h back and corrects drift — see src/crons/reconciliation.ts).
 */
async function handleError(
  txId: string,
  deps: WebhookGatewayDeps,
  escrowEvent: string,
): Promise<{ newState: string }> {
  const transition = await deps.transactTransition({
    txId,
    fromState: "PENDING",
    toState: "ERROR",
    idempotencyKey: `${txId}:${escrowEvent}`,
  });
  return { newState: transition.toState };
}

// Re-export for consumers
export { FraudSignalError };
