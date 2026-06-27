/**
 * Tests for WalletWidget React island.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { WalletWidget } from "./WalletWidget.js";
import { apiClient } from "../../lib/api-client.js";

describe("<WalletWidget />", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  const baseBalance = {
    user_id: "u1",
    balance_cop: 50_000,
    tier: 1 as const,
    kyc_state: "VERIFIED" as const,
    trust_badge: null,
    receive_limit_day_cop: 2_000_000,
    withdraw_limit_day_cop: 1_000_000,
    withdraw_hold_hours: 24,
  };

  it("renders skeleton while loading", () => {
    vi.spyOn(apiClient, "getBalance").mockReturnValue(new Promise(() => {}));
    render(<WalletWidget userId="u1" />);
    expect(screen.getByTestId("wallet-skeleton")).toBeInTheDocument();
  });

  it("displays balance in Colombian peso format", async () => {
    vi.spyOn(apiClient, "getBalance").mockResolvedValue(baseBalance);
    render(<WalletWidget userId="u1" />);
    await waitFor(() => {
      // Intl.NumberFormat("es-CO", { currency: "COP" }) produces "$ 50.000"
      expect(screen.getByTestId("wallet-balance").textContent).toMatch(/50[.,]000/);
    });
  });

  it("displays withdraw limits and hold time", async () => {
    vi.spyOn(apiClient, "getBalance").mockResolvedValue(baseBalance);
    render(<WalletWidget userId="u1" />);
    await waitFor(() => {
      expect(screen.getByTestId("wallet-widget")).toHaveTextContent("1.000.000");
      expect(screen.getByTestId("wallet-widget")).toHaveTextContent("Hold 24h");
    });
  });

  it("toggles withdraw form on button click", async () => {
    vi.spyOn(apiClient, "getBalance").mockResolvedValue(baseBalance);
    render(<WalletWidget userId="u1" />);
    await waitFor(() => screen.getByTestId("withdraw-toggle"));

    expect(screen.queryByTestId("withdraw-form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("withdraw-toggle"));
    expect(screen.getByTestId("withdraw-form")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("withdraw-toggle"));
    expect(screen.queryByTestId("withdraw-form")).not.toBeInTheDocument();
  });

  it("submits withdraw form with phone + amount", async () => {
    const withdrawSpy = vi.spyOn(apiClient, "withdraw").mockResolvedValue({
      withdrawal_id: "wd-1",
      status: "PROCESSING",
      available_at: new Date().toISOString(),
    });
    vi.spyOn(apiClient, "getBalance")
      .mockResolvedValueOnce(baseBalance)
      .mockResolvedValueOnce({ ...baseBalance, balance_cop: 30_000 });

    render(<WalletWidget userId="u1" />);
    await waitFor(() => screen.getByTestId("withdraw-toggle"));
    fireEvent.click(screen.getByTestId("withdraw-toggle"));

    fireEvent.change(screen.getByTestId("withdraw-phone"), {
      target: { value: "+573001234567" },
    });
    fireEvent.change(screen.getByTestId("withdraw-amount"), {
      target: { value: "20000" },
    });
    fireEvent.click(screen.getByTestId("withdraw-submit"));

    await waitFor(() => {
      expect(withdrawSpy).toHaveBeenCalledWith("u1", {
        amount_cop: 20_000,
        destination: { kind: "BREB", phone: "+573001234567" },
      });
    });
  });
});