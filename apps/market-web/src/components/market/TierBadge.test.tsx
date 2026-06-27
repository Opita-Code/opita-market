/**
 * Tests for TierBadge React island.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { TierBadge } from "./TierBadge.js";
import { apiClient } from "../../lib/api-client.js";

describe("<TierBadge />", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders skeleton while loading", () => {
    vi.spyOn(apiClient, "getTier").mockReturnValue(new Promise(() => {}));
    render(<TierBadge userId="u1" />);
    expect(screen.getByTestId("tier-badge-skeleton")).toBeInTheDocument();
  });

  it("renders Tier 2 badge with correct styling after fetch", async () => {
    vi.spyOn(apiClient, "getTier").mockResolvedValue({
      user_id: "u1",
      current_tier: 2,
      current_tier_name: "Vendedor verificado",
      trust_badge: "Vendedor verificado",
      progress_to_next_tier: null,
    });
    render(<TierBadge userId="u1" />);
    await waitFor(() => {
      expect(screen.getByTestId("tier-badge")).toHaveTextContent("Vendedor verificado");
    });
    expect(screen.getByTestId("tier-badge")).toHaveAttribute("data-tier", "2");
  });

  it("renders Tier 0 without badge (just name)", async () => {
    vi.spyOn(apiClient, "getTier").mockResolvedValue({
      user_id: "u1",
      current_tier: 0,
      current_tier_name: "Sin verificar",
      trust_badge: null,
      progress_to_next_tier: null,
    });
    render(<TierBadge userId="u1" />);
    await waitFor(() => {
      expect(screen.getByTestId("tier-badge")).toHaveTextContent("Sin verificar");
    });
  });

  it("uses initialTier when provided (no fetch)", () => {
    const initial = {
      user_id: "u1",
      current_tier: 3 as const,
      current_tier_name: "Negocio verificado",
      trust_badge: "Negocio verificado",
      progress_to_next_tier: null,
    };
    const spy = vi.spyOn(apiClient, "getTier");
    render(<TierBadge userId="u1" initialTier={initial} />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId("tier-badge")).toHaveTextContent("Negocio verificado");
  });

  it("shows error state on fetch failure", async () => {
    vi.spyOn(apiClient, "getTier").mockRejectedValue(new Error("Network error"));
    render(<TierBadge userId="u1" />);
    await waitFor(() => {
      expect(screen.getByTestId("tier-badge-error")).toBeInTheDocument();
    });
  });
});