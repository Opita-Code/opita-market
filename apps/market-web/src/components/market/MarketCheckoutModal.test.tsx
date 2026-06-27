/**
 * Tests for MarketCheckoutModal — payment flow with Wompi widget injection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MarketCheckoutModal } from "./MarketCheckoutModal.js";
import { apiClient } from "../../lib/api-client.js";
import * as wompiWidget from "../../lib/wompi-widget.js";

describe("<MarketCheckoutModal />", () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    amountCop: 100_000,
    channel: "WOMPI_CARD" as const,
    fromUserId: "buyer@opita.co",
    toUserId: "seller@opita.co",
    productContext: { kind: "MARKETPLACE_ORDER", ref_id: "prod-1" },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(wompiWidget, "injectWompiWidget").mockReturnValue(document.createElement("script"));
    vi.spyOn(wompiWidget, "removeWompiWidget").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
  });

  it("does not render when open=false", () => {
    render(<MarketCheckoutModal {...baseProps} open={false} />);
    expect(screen.queryByTestId("checkout-modal")).not.toBeInTheDocument();
  });

  it("renders loading state initially", () => {
    vi.spyOn(apiClient, "createPaymentIntent").mockReturnValue(new Promise(() => {}));
    render(<MarketCheckoutModal {...baseProps} />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();
  });

  it("injects Wompi widget when intent is ready", async () => {
    vi.spyOn(apiClient, "createPaymentIntent").mockResolvedValue({
      transaction_id: "tx-1",
      reference: "REF-1",
      amount_in_cents: 100_000,
      currency: "COP",
      public_key: "pub_test_KEY",
      integrity_signature: "abc123",
      requires_3ds: false,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    const injectSpy = vi.spyOn(wompiWidget, "injectWompiWidget");

    render(<MarketCheckoutModal {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId("widget-container")).toBeInTheDocument();
    });

    expect(injectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        publicKey: "pub_test_KEY",
        amountInCents: 100_000,
        reference: "REF-1",
        signatureIntegrity: "abc123",
      }),
    );
  });

  it("shows error state when intent creation fails", async () => {
    vi.spyOn(apiClient, "createPaymentIntent").mockRejectedValue(
      Object.assign(new Error("Network"), { status: 500, code: "INTENT_FAILED" }),
    );
    render(<MarketCheckoutModal {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId("error")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    vi.spyOn(apiClient, "createPaymentIntent").mockResolvedValue({
      transaction_id: "tx-1",
      reference: "REF-1",
      amount_in_cents: 100_000,
      currency: "COP",
      public_key: "k",
      integrity_signature: "s",
      requires_3ds: false,
      expires_at: new Date().toISOString(),
    });
    render(<MarketCheckoutModal {...baseProps} onClose={onClose} />);
    await waitFor(() => screen.getByTestId("modal-close"));

    fireEvent.click(screen.getByTestId("modal-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses crypto.randomUUID for idempotency key (uniqueness across reopens)", async () => {
    const spy = vi.spyOn(apiClient, "createPaymentIntent");
    spy.mockResolvedValue({
      transaction_id: "tx-1", reference: "R", amount_in_cents: 100_000,
      currency: "COP", public_key: "k", integrity_signature: "s",
      requires_3ds: false, expires_at: new Date().toISOString(),
    });

    const { unmount } = render(<MarketCheckoutModal {...baseProps} />);
    await waitFor(() => screen.getByTestId("widget-container"));
    unmount();

    render(<MarketCheckoutModal {...baseProps} />);
    await waitFor(() => screen.getByTestId("widget-container"));

    // Two different calls → two different idempotency keys
    const call1 = spy.mock.calls[0];
    const call2 = spy.mock.calls[1];
    expect(call1).toBeDefined();
    expect(call2).toBeDefined();
    const key1 = call1![0].idempotency_key;
    const key2 = call2![0].idempotency_key;
    expect(key1).not.toBe(key2);
  });
});