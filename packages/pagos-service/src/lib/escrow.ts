/**
 * Escrow state machine for Opita Pagos.
 *
 * Manages the lifecycle of card payments (held in escrow until delivery is
 * confirmed) vs Bre-B payments (released instantly, no dispute window).
 *
 * STATE TRANSITIONS (card channel):
 *   NONE     → HELD      (Wompi webhook: APPROVED)
 *   HELD     → RELEASED  (delivery webhook + evidence)
 *   HELD     → REFUNDED  (Wompi webhook: CHARGEBACK)
 *   RELEASED → DISPUTED  (buyer dispute within 72h post-release)
 *   RELEASED → REFUNDED  (late chargeback)
 *   DISPUTED → RELEASED  (DPO resolves for seller)
 *   DISPUTED → REFUNDED  (DPO resolves for buyer)
 *
 * STATE TRANSITIONS (Bre-B channel):
 *   NONE → RELEASED (instant, no escrow)
 *
 * RULES:
 *   - Evidence of delivery (photo + signature) required for tx > $1M COP
 *   - Dispute window is 72h post-RELEASED (configurable via constant)
 *   - Terminal states (RELEASED, REFUNDED) cannot transition out of dispute resolution
 *   - Bre-B cannot be disputed (A2A is irreversible)
 */

import type { EscrowState } from "../db/tables.js";
import { isSafeUrl } from "./ssrf-guard.js";
import { UnsafeEvidenceUrlError } from "./errors.js";

export const DISPUTE_WINDOW_HOURS = 72;
export const EVIDENCE_REQUIRED_ABOVE_COP = 1_000_000;

export type EscrowEvent =
  | "WOMPI_APPROVED"
  | "WOMPI_CHARGEBACK"
  | "DELIVERY_CONFIRM"
  | "BUYER_DISPUTE"
  | "DPO_RESOLVE";

export type DisputeReason = "NOT_RECEIVED" | "DAMAGED" | "NOT_AS_DESCRIBED";

export interface DeliveryEvidence {
  delivered_at: string; // ISO 8601
  recipient_name: string;
  photo_url?: string;
  signature_png?: string;
  tracking_number: string;
}

export interface EscrowTransaction {
  transaction_id: string;
  amount_cop: number;
  channel: "WOMPI_CARD" | "WOMPI_BREB" | "WOMPI_PSE" | "WOMPI_NEQUI" | "WOMPI_DAVIPLATA" | "INTERNAL_TRANSFER";
  escrow_state: EscrowState;
  escrow_released_at?: string;
  dispute_window_ends_at?: string;
  created_at: string;
}

export interface DisputePayload {
  reason: DisputeReason;
  description: string;
  evidence_urls?: string[];
}

export interface DpoResolutionPayload {
  resolution: "FOR_SELLER" | "FOR_BUYER";
}

export interface TransitionPayload {
  evidence?: DeliveryEvidence;
  reason?: DisputeReason;
  description?: string;
  evidence_urls?: string[];
  resolution?: "FOR_SELLER" | "FOR_BUYER";
}

export interface TransitionResult extends EscrowTransaction {
  /** Set when transition was rejected. Always present in result (may be undefined). */
  error:
    | "INVALID_TRANSITION"
    | "EVIDENCE_REQUIRED"
    | "DISPUTE_WINDOW_CLOSED"
    | "UNSAFE_EVIDENCE_URL"
    | undefined;
}

const FULL_EVIDENCE_FIELDS: Array<keyof DeliveryEvidence> = [
  "delivered_at",
  "recipient_name",
  "tracking_number",
  "photo_url",
  "signature_png",
];

export class EscrowStateMachine {
  /**
   * Apply an event to the escrow transaction. Returns a NEW transaction with
   * the updated state (input is not mutated).
   */
  transition(
    tx: EscrowTransaction,
    event: EscrowEvent,
    payload: TransitionPayload = {},
  ): TransitionResult {
    // Br-B (and other instant channels) skip escrow entirely
    if (tx.channel === "WOMPI_BREB" || tx.channel === "WOMPI_NEQUI" || tx.channel === "WOMPI_DAVIPLATA") {
      if (event === "WOMPI_APPROVED" && tx.escrow_state === "NONE") {
        return this.markReleased(tx);
      }
      return invalid(tx);
    }

    // Card / PSE channels — full state machine
    return this.cardTransition(tx, event, payload);
  }

  private cardTransition(
    tx: EscrowTransaction,
    event: EscrowEvent,
    payload: TransitionPayload,
  ): TransitionResult {
    switch (tx.escrow_state) {
      case "NONE":
        if (event === "WOMPI_APPROVED") return this.markHeld(tx);
        return invalid(tx);

      case "HELD":
        if (event === "DELIVERY_CONFIRM") return this.handleDeliveryConfirm(tx, payload);
        if (event === "WOMPI_CHARGEBACK") return this.markRefunded(tx);
        return invalid(tx);

      case "RELEASED":
        if (event === "BUYER_DISPUTE") return this.handleBuyerDispute(tx, payload);
        if (event === "WOMPI_CHARGEBACK") return this.markRefunded(tx);
        return invalid(tx);

      case "DISPUTED":
        if (event === "DPO_RESOLVE") return this.handleDpoResolve(tx, payload);
        return invalid(tx);

      case "REFUNDED":
        // Terminal state
        return invalid(tx);

      default:
        return invalid(tx);
    }
  }

  // ─── State transition handlers ───────────────────────────────────────────

  private markHeld(tx: EscrowTransaction): TransitionResult {
    return ok(tx, { escrow_state: "HELD" });
  }

  private markReleased(tx: EscrowTransaction): TransitionResult {
    const now = new Date().toISOString();
    const disputeEnd = new Date(Date.now() + DISPUTE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    return ok(tx, {
      escrow_state: "RELEASED",
      escrow_released_at: now,
      dispute_window_ends_at: disputeEnd,
    });
  }

  private markRefunded(tx: EscrowTransaction): TransitionResult {
    return ok(tx, { escrow_state: "REFUNDED" });
  }

  private handleDeliveryConfirm(
    tx: EscrowTransaction,
    payload: TransitionPayload,
  ): TransitionResult {
    const evidence = payload.evidence;
    if (!evidence) {
      return { ...tx, error: "EVIDENCE_REQUIRED" };
    }

    // PR 2e (closes OPL-LIB-004, OPL-CARD-009): SSRF guard on photo_url
    // If a photo_url is provided, it MUST be a public http(s) URL — no
    // internal IPs, no file://, no javascript:, no AWS IMDS, etc.
    if (evidence.photo_url) {
      const ssrfCheck = isSafeUrl(evidence.photo_url);
      if (!ssrfCheck.safe) {
        return { ...tx, error: "UNSAFE_EVIDENCE_URL" };
      }
    }

    // For tx > $1M COP, require photo_url AND signature_png
    if (tx.amount_cop > EVIDENCE_REQUIRED_ABOVE_COP) {
      const missingFull = !evidence.photo_url || !evidence.signature_png;
      const missingBasic = !evidence.delivered_at || !evidence.recipient_name || !evidence.tracking_number;
      if (missingFull || missingBasic) {
        return { ...tx, error: "EVIDENCE_REQUIRED" };
      }
    } else {
      const missingBasic = !evidence.delivered_at || !evidence.recipient_name || !evidence.tracking_number;
      if (missingBasic) {
        return { ...tx, error: "EVIDENCE_REQUIRED" };
      }
    }

    return this.markReleased(tx);
  }

  private handleBuyerDispute(
    tx: EscrowTransaction,
    payload: TransitionPayload,
  ): TransitionResult {
    if (!tx.dispute_window_ends_at) {
      return { ...tx, error: "INVALID_TRANSITION" };
    }
    const windowEnd = new Date(tx.dispute_window_ends_at).getTime();
    if (Date.now() > windowEnd) {
      return { ...tx, error: "DISPUTE_WINDOW_CLOSED" };
    }
    if (!payload.reason) {
      return { ...tx, error: "INVALID_TRANSITION" };
    }
    return ok(tx, { escrow_state: "DISPUTED" });
  }

  private handleDpoResolve(
    tx: EscrowTransaction,
    payload: TransitionPayload,
  ): TransitionResult {
    if (payload.resolution === "FOR_SELLER") {
      return ok(tx, { escrow_state: "RELEASED" });
    }
    if (payload.resolution === "FOR_BUYER") {
      return ok(tx, { escrow_state: "REFUNDED" });
    }
    return { ...tx, error: "INVALID_TRANSITION" };
  }
}

function ok(tx: EscrowTransaction, updates: Partial<EscrowTransaction> = {}): TransitionResult {
  return { ...tx, ...updates, error: undefined };
}

function invalid(tx: EscrowTransaction): TransitionResult {
  return { ...tx, error: "INVALID_TRANSITION" };
}

// Re-export the EscrowState alias for convenience
export type { EscrowState };