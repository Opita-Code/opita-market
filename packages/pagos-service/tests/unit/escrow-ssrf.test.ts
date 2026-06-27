import { describe, it, expect } from "vitest";
import { EscrowStateMachine, type EscrowTransaction } from "../../src/lib/escrow.js";
import { UnsafeEvidenceUrlError } from "../../src/lib/errors.js";

/**
 * Tests for PR 2e — Escrow photo_url SSRF protection (closes OPL-LIB-004, OPL-CARD-009).
 *
 * DeliveryEvidence.photo_url must be validated via SSRF guard before being
 * stored. Unsafe URLs throw UnsafeEvidenceUrlError.
 */

function makeTx(amount = 2_000_000): EscrowTransaction {
  return {
    transaction_id: "tx-1",
    amount_cop: amount,
    channel: "WOMPI_CARD",
    escrow_state: "HELD",
    created_at: new Date().toISOString(),
  };
}

describe("PR 2e — escrow photo_url SSRF guard", () => {
  it("accepts valid public https:// URL", () => {
    const m = new EscrowStateMachine();
    const tx = makeTx();
    const r = m.transition(tx, "DELIVERY_CONFIRM", {
      evidence: {
        delivered_at: new Date().toISOString(),
        recipient_name: "Test Recipient",
        tracking_number: "TRK-001",
        photo_url: "https://example.com/photo.jpg",
        signature_png: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.escrow_state).toBe("RELEASED");
  });

  it("rejects photo_url pointing to internal IP (10.x.x.x)", () => {
    const m = new EscrowStateMachine();
    const tx = makeTx();
    const r = m.transition(tx, "DELIVERY_CONFIRM", {
      evidence: {
        delivered_at: new Date().toISOString(),
        recipient_name: "Test",
        tracking_number: "TRK-001",
        photo_url: "http://10.0.0.1/internal.jpg",
        signature_png: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    expect(r.error).toBe("UNSAFE_EVIDENCE_URL");
  });

  it("rejects photo_url pointing to AWS IMDS (169.254.169.254)", () => {
    const m = new EscrowStateMachine();
    const tx = makeTx();
    const r = m.transition(tx, "DELIVERY_CONFIRM", {
      evidence: {
        delivered_at: new Date().toISOString(),
        recipient_name: "Test",
        tracking_number: "TRK-001",
        photo_url: "http://169.254.169.254/latest/meta-data/",
        signature_png: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    expect(r.error).toBe("UNSAFE_EVIDENCE_URL");
  });

  it("rejects file:// scheme", () => {
    const m = new EscrowStateMachine();
    const r = m.transition(makeTx(), "DELIVERY_CONFIRM", {
      evidence: {
        delivered_at: new Date().toISOString(),
        recipient_name: "Test",
        tracking_number: "TRK-001",
        photo_url: "file:///etc/passwd",
        signature_png: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    expect(r.error).toBe("UNSAFE_EVIDENCE_URL");
  });

  it("rejects javascript: scheme (XSS via image metadata)", () => {
    const m = new EscrowStateMachine();
    const r = m.transition(makeTx(), "DELIVERY_CONFIRM", {
      evidence: {
        delivered_at: new Date().toISOString(),
        recipient_name: "Test",
        tracking_number: "TRK-001",
        photo_url: "javascript:alert(1)",
        signature_png: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    expect(r.error).toBe("UNSAFE_EVIDENCE_URL");
  });

  it("allows transaction with no photo_url (only required for tx > 1M)", () => {
    const m = new EscrowStateMachine();
    const tx = makeTx(500_000); // below 1M threshold
    const r = m.transition(tx, "DELIVERY_CONFIRM", {
      evidence: {
        delivered_at: new Date().toISOString(),
        recipient_name: "Test",
        tracking_number: "TRK-001",
        // No photo_url, no signature_png
      },
    });
    expect(r.error).toBeUndefined();
  });
});
