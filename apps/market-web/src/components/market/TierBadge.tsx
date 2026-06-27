/**
 * TierBadge — shows the user's current KYC tier as a small badge.
 *
 * Hydration: client:load (small, always visible).
 *
 * Tiers (per src/lib/tiers.ts):
 *   0: Sin verificar
 *   1: Email verificado
 *   2: Vendedor verificado
 *   3: Negocio verificado
 *   4: Empresa verificada
 */
import { useEffect, useState } from "react";
import { apiClient, ApiClientError, type TierResponse } from "../../lib/api-client";

export interface TierBadgeProps {
  userId: string;
  /** Server-side pre-fetched tier (avoids the client fetch). */
  initialTier?: TierResponse;
}

const TIER_STYLES: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  1: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  2: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  3: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  4: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
};

export function TierBadge({ userId, initialTier }: TierBadgeProps) {
  const [tier, setTier] = useState<TierResponse | null>(initialTier ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTier) return; // skip fetch if we have SSR data
    let cancelled = false;
    apiClient.getTier(userId)
      .then((t) => { if (!cancelled) setTier(t); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiClientError ? e.code : "FETCH_FAILED");
      });
    return () => { cancelled = true; };
  }, [userId, initialTier]);

  if (error) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500" data-testid="tier-badge-error">
        —
      </span>
    );
  }

  if (!tier) {
    return <span className="inline-block w-20 h-5 rounded bg-slate-200 animate-pulse" data-testid="tier-badge-skeleton" />;
  }

  if (!tier.trust_badge) {
    // Tier 0 or 1 — no badge, just show "Sin verificar" subtle
    return (
      <span
        className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 border border-slate-200"
        data-testid="tier-badge"
        data-tier={tier.current_tier}
      >
        {tier.current_tier_name}
      </span>
    );
  }

  const style = TIER_STYLES[tier.current_tier] ?? TIER_STYLES[0]!;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${style.bg} ${style.text} ${style.border}`}
      data-testid="tier-badge"
      data-tier={tier.current_tier}
      aria-label={`Tier ${tier.current_tier}: ${tier.trust_badge}`}
    >
      ✓ {tier.trust_badge}
    </span>
  );
}