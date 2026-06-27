import { describe, it, expect } from "vitest";
import {
  EscrowStateMachine,
  type EscrowTransaction,
  type DeliveryEvidence,
  type DisputeReason,
} from "../../src/lib/escrow.js";

/**
 * Tests for the Escrow state machine.
 *
 * STATES: NONE → HELD → RELEASED / DISPUTED / REFUNDED (terminal)
 *
 * TRANSITIONS:
 *   NONE     → HELD     (Wompi webhook: APPROVED on card channel)
 *   NONE     → RELEASED (instant for Bre-B — A2A irreversible)
 *   HELD     → RELEASED (delivery webhook with valid evidence)
 *   HELD     → DISPUTED (buyer opens dispute within 72h post-RELEASE)
 *   HELD     → REFUNDED (Wompi webhook: CHARGEBACK)
 *   DISPUTED → RELEASED (DPO resolves in favor of seller)
 *   DISPUTED → REFUNDED (DPO resolves in favor of buyer)
 *
 * RULES:
 *   - Card transactions always go through escrow
 *   - Bre-B transactions skip escrow (instant release)
 *   - Evidence of delivery required for tx > $1M COP
 *   - Dispute window is 72h post-RELEASE
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DISPUTE_WINDOW_HOURS = 72;

function makeCardTx(overrides: Partial<EscrowTransaction> = {}): EscrowTransaction {
  return {
    transaction_id: "tx-1",
    amount_cop: 500_000,
    channel: "WOMPI_CARD",
    escrow_state: "NONE",
    created_at: "2026-06-25T10:00:00Z",
    ...overrides,
  };
}

function makeBreBTx(overrides: Partial<EscrowTransaction> = {}): EscrowTransaction {
  return {
    transaction_id: "tx-breb",
    amount_cop: 500_000,
    channel: "WOMPI_BREB",
    escrow_state: "NONE",
    created_at: "2026-06-25T10:00:00Z",
    ...overrides,
  };
}

const validEvidence: DeliveryEvidence = {
  delivered_at: "2026-06-26T14:00:00Z",
  recipient_name: "Juan Pérez",
  photo_url: "https://example.com/photo.jpg",
  signature_png: "https://example.com/sig.png",
  tracking_number: "TRK12345",
};

describe("escrow — state machine transitions", () => {
  describe("card payments (escrow required)", () => {
    it("NONE → HELD on APPROVED webhook", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx();
      const result = sm.transition(tx, "WOMPI_APPROVED");
      expect(result.escrow_state).toBe("HELD");
      expect(result.error).toBeUndefined();
    });

    it("NONE → HELD cannot happen twice", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "HELD" });
      const result = sm.transition(tx, "WOMPI_APPROVED");
      expect(result.escrow_state).toBe("HELD"); // unchanged
      expect(result.error).toBe("INVALID_TRANSITION");
    });

    it("HELD → RELEASED on delivery confirm with valid evidence", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "HELD",
        escrow_released_at: undefined,
        dispute_window_ends_at: undefined,
      });
      const result = sm.transition(tx, "DELIVERY_CONFIRM", { evidence: validEvidence });
      expect(result.escrow_state).toBe("RELEASED");
      expect(result.escrow_released_at).toBeDefined();
      expect(result.dispute_window_ends_at).toBeDefined();
    });

    it("HELD → RELEASED requires evidence (rejects without)", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "HELD" });
      const result = sm.transition(tx, "DELIVERY_CONFIRM");
      expect(result.escrow_state).toBe("HELD");
      expect(result.error).toBe("EVIDENCE_REQUIRED");
    });

    it("HELD → RELEASED requires full evidence for tx > $1M COP", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "HELD",
        amount_cop: 2_000_000, // > $1M COP
      });
      const partial: DeliveryEvidence = {
        delivered_at: "2026-06-26T14:00:00Z",
        recipient_name: "Juan Pérez",
        tracking_number: "TRK12345",
        // photo_url and signature_png MISSING
      };
      const result = sm.transition(tx, "DELIVERY_CONFIRM", { evidence: partial });
      expect(result.escrow_state).toBe("HELD");
      expect(result.error).toBe("EVIDENCE_REQUIRED");
    });

    it("HELD → DISPUTED on buyer dispute within window", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "RELEASED",
        escrow_released_at: "2026-06-26T14:00:00Z",
        dispute_window_ends_at: "2026-06-29T14:00:00Z", // +72h
      });
      const result = sm.transition(tx, "BUYER_DISPUTE", {
        reason: "NOT_RECEIVED",
        description: "Package never arrived",
        evidence_urls: ["https://example.com/claim.jpg"],
      });
      expect(result.escrow_state).toBe("DISPUTED");
    });

    it("DISPUTED → DISPUTE after window expires", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "RELEASED",
        escrow_released_at: "2026-06-20T10:00:00Z", // 6 days ago
        dispute_window_ends_at: "2026-06-23T10:00:00Z",
      });
      const result = sm.transition(tx, "BUYER_DISPUTE", {
        reason: "NOT_RECEIVED",
        description: "Late dispute",
      });
      expect(result.escrow_state).toBe("RELEASED"); // unchanged
      expect(result.error).toBe("DISPUTE_WINDOW_CLOSED");
    });

    it("HELD → REFUNDED on chargeback", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "HELD" });
      const result = sm.transition(tx, "WOMPI_CHARGEBACK");
      expect(result.escrow_state).toBe("REFUNDED");
    });

    it("RELEASED → REFUNDED on late chargeback", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "RELEASED",
        escrow_released_at: "2026-06-26T14:00:00Z",
        dispute_window_ends_at: "2026-06-29T14:00:00Z",
      });
      const result = sm.transition(tx, "WOMPI_CHARGEBACK");
      expect(result.escrow_state).toBe("REFUNDED");
    });

    it("DISPUTED → RELEASED on DPO resolves for seller", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "DISPUTED" });
      const result = sm.transition(tx, "DPO_RESOLVE", { resolution: "FOR_SELLER" });
      expect(result.escrow_state).toBe("RELEASED");
    });

    it("DISPUTED → REFUNDED on DPO resolves for buyer", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "DISPUTED" });
      const result = sm.transition(tx, "DPO_RESOLVE", { resolution: "FOR_BUYER" });
      expect(result.escrow_state).toBe("REFUNDED");
    });
  });

  describe("Bre-B payments (skip escrow)", () => {
    it("NONE → RELEASED directly (instant)", () => {
      const sm = new EscrowStateMachine();
      const tx = makeBreBTx();
      const result = sm.transition(tx, "WOMPI_APPROVED");
      expect(result.escrow_state).toBe("RELEASED");
      expect(result.error).toBeUndefined();
      expect(result.escrow_released_at).toBeDefined();
    });

    it("Bre-B does NOT have dispute window (A2A irreversible)", () => {
      const sm = new EscrowStateMachine();
      const tx = makeBreBTx({ escrow_state: "RELEASED" });
      const result = sm.transition(tx, "BUYER_DISPUTE", {
        reason: "NOT_RECEIVED",
        description: "test",
      });
      expect(result.escrow_state).toBe("RELEASED");
      expect(result.error).toBe("INVALID_TRANSITION");
    });
  });

  describe("terminal states are immutable", () => {
    it("RELEASED → cannot transition to HELD", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "RELEASED" });
      const result = sm.transition(tx, "WOMPI_APPROVED");
      expect(result.escrow_state).toBe("RELEASED");
      expect(result.error).toBe("INVALID_TRANSITION");
    });

    it("REFUNDED → cannot transition to RELEASED", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "REFUNDED" });
      const result = sm.transition(tx, "DELIVERY_CONFIRM", { evidence: validEvidence });
      expect(result.escrow_state).toBe("REFUNDED");
      expect(result.error).toBe("INVALID_TRANSITION");
    });

    it("RELEASED → only allowed transitions are CHARGEBACK or DPO_RESOLVE", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({ escrow_state: "RELEASED" });
      const result1 = sm.transition(tx, "DELIVERY_CONFIRM", { evidence: validEvidence });
      expect(result1.error).toBe("INVALID_TRANSITION");

      const result2 = sm.transition(tx, "WOMPI_CHARGEBACK");
      expect(result2.escrow_state).toBe("REFUNDED");
    });
  });

  describe("evidence requirements", () => {
    it("requires photo_url for tx > $1M COP", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "HELD",
        amount_cop: 1_500_000,
      });
      const evidence: DeliveryEvidence = {
        delivered_at: "2026-06-26T14:00:00Z",
        recipient_name: "Juan",
        signature_png: "https://example.com/sig.png",
        tracking_number: "TRK1",
        // photo_url MISSING
      };
      const result = sm.transition(tx, "DELIVERY_CONFIRM", { evidence });
      expect(result.error).toBe("EVIDENCE_REQUIRED");
    });

    it("requires signature_png for tx > $1M COP", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "HELD",
        amount_cop: 1_500_000,
      });
      const evidence: DeliveryEvidence = {
        delivered_at: "2026-06-26T14:00:00Z",
        recipient_name: "Juan",
        photo_url: "https://example.com/photo.jpg",
        tracking_number: "TRK1",
        // signature_png MISSING
      };
      const result = sm.transition(tx, "DELIVERY_CONFIRM", { evidence });
      expect(result.error).toBe("EVIDENCE_REQUIRED");
    });

    it("photo + signature not required for tx ≤ $1M COP", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "HELD",
        amount_cop: 500_000, // ≤ $1M
      });
      const evidence: DeliveryEvidence = {
        delivered_at: "2026-06-26T14:00:00Z",
        recipient_name: "Juan",
        tracking_number: "TRK1",
      };
      const result = sm.transition(tx, "DELIVERY_CONFIRM", { evidence });
      expect(result.escrow_state).toBe("RELEASED");
    });
  });

  describe("dispute window computation", () => {
    it("dispute_window_ends_at = released_at + 72h", () => {
      const sm = new EscrowStateMachine();
      const tx = makeCardTx({
        escrow_state: "HELD",
      });
      const result = sm.transition(tx, "DELIVERY_CONFIRM", {
        evidence: {
          delivered_at: "2026-06-26T14:00:00Z",
          recipient_name: "Juan",
          tracking_number: "TRK1",
        },
      });
      expect(result.escrow_released_at).toBeDefined();
      expect(result.dispute_window_ends_at).toBeDefined();

      const released = new Date(result.escrow_released_at!).getTime();
      const windowEnd = new Date(result.dispute_window_ends_at!).getTime();
      expect(windowEnd - released).toBe(72 * HOUR);
    });
  });
});

describe("escrow — invariants", () => {
  it("every state transition returns an updated tx AND error info", () => {
    const sm = new EscrowStateMachine();
    const tx = makeCardTx();
    const result = sm.transition(tx, "WOMPI_APPROVED");
    expect(result).toHaveProperty("escrow_state");
    expect("error" in result).toBe(true); // field always present (may be undefined)
  });

  it("does not mutate the input tx (immutable)", () => {
    const sm = new EscrowStateMachine();
    const tx = makeCardTx();
    const originalState = tx.escrow_state;
    sm.transition(tx, "WOMPI_APPROVED");
    expect(tx.escrow_state).toBe(originalState);
  });

  it("DISPUTE_WINDOW_HOURS constant is 72", () => {
    expect(DISPUTE_WINDOW_HOURS).toBe(72);
  });
});