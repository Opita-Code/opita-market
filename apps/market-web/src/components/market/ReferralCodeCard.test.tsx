/**
 * Tests for ReferralCodeCard React island.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { ReferralCodeCard } from "./ReferralCodeCard.js";
import { apiClient } from "../../lib/api-client.js";

describe("<ReferralCodeCard />", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock clipboard
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the code when initialCode is provided", () => {
    render(<ReferralCodeCard userId="u1" initialCode="ABC12345" />);
    expect(screen.getByTestId("referral-code")).toHaveTextContent("ABC12345");
  });

  it("fetches code from API when no initialCode", async () => {
    const spy = vi.spyOn(apiClient, "getReferralCode").mockResolvedValue({
      user_id: "u1",
      referral_code: "XYZ98765",
    });
    render(<ReferralCodeCard userId="u1" />);
    await waitFor(() => {
      expect(screen.getByTestId("referral-code")).toHaveTextContent("XYZ98765");
    });
    expect(spy).toHaveBeenCalledWith("u1");
  });

  it("copies code to clipboard on button click", async () => {
    const writeSpy = vi.mocked(navigator.clipboard.writeText);
    render(<ReferralCodeCard userId="u1" initialCode="TESTCODE" />);

    fireEvent.click(screen.getByTestId("referral-copy"));

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith("TESTCODE");
    });
    expect(screen.getByTestId("referral-copy")).toHaveTextContent("¡Copiado!");
  });

  it("shows error when fetch fails", async () => {
    vi.spyOn(apiClient, "getReferralCode").mockRejectedValue(new Error("Network"));
    render(<ReferralCodeCard userId="u1" />);
    await waitFor(() => {
      expect(screen.getByTestId("referral-error")).toBeInTheDocument();
    });
  });
});