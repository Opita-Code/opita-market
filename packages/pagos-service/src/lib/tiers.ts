/**
 * Tier definitions for Opita Market / Opita Pagos.
 *
 * Five tiers (0-4). Each tier defines:
 *   - KYC requirements to reach the tier
 *   - Receive limits (max incoming COP per day / week)
 *   - Withdraw limits (max outgoing COP per day)
 *   - Withdraw hold window (T+Xh before funds are available to withdraw)
 *   - 3DS threshold (above this amount, 3DS is mandatory for cards)
 *   - Trust badge label (shown to counterparties)
 *
 * Rural-aware: Tier 2 ($20M receive/day) covers typical rural commerce
 * (cattle sales, harvest sales, agro-distribution). Tier 3 ($100M/day)
 * covers medium businesses. Tier 4 ($500M/day) covers enterprises
 * (cooperatives, agro-industry) — required for zona-rural integration.
 */

export type Tier = 0 | 1 | 2 | 3 | 4;

export interface TierConfig {
  tier: Tier;
  name: string;
  description: string;
  badge: string | null;
  requirements: string[];
  receiveLimitDayCop: number;
  receiveLimitWeekCop: number;
  withdrawLimitDayCop: number;
  withdrawHoldHours: number;
  /** Above this amount (in COP), 3DS is mandatory for card payments. */
  threeDsThresholdCop: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  0: {
    tier: 0,
    name: "Sin verificar",
    description: "Registro mínimo con celular. Sin verificación de identidad.",
    badge: null,
    requirements: ["Número de celular colombiano verificado vía SMS"],
    receiveLimitDayCop: 500_000,        // $500k COP/día
    receiveLimitWeekCop: 2_000_000,     // $2M COP/semana
    withdrawLimitDayCop: 200_000,        // $200k COP/día
    withdrawHoldHours: 72,               // T+72h
    threeDsThresholdCop: 0,              // 3DS siempre (no verificación)
  },
  1: {
    tier: 1,
    name: "Email verificado",
    description: "Datos básicos. Email confirmado.",
    badge: null,
    requirements: [
      "Celular verificado",
      "Email confirmado",
      "Nombre completo",
      "Ciudad de operación",
    ],
    receiveLimitDayCop: 2_000_000,       // $2M COP/día
    receiveLimitWeekCop: 10_000_000,     // $10M COP/semana
    withdrawLimitDayCop: 1_000_000,      // $1M COP/día
    withdrawHoldHours: 24,               // T+24h
    threeDsThresholdCop: 200_000,        // >$200k COP exige 3DS
  },
  2: {
    tier: 2,
    name: "Vendedor verificado",
    description: "NIT validado contra RUES vía Verifik. Badge público.",
    badge: "Vendedor verificado",
    requirements: [
      "Celular verificado",
      "Email confirmado",
      "Nombre completo",
      "Ciudad de operación",
      "Razón social",
      "NIT (validado por Verifik/RUES)",
      "DV del NIT (verificado)",
      "Consentimiento Ley 1581 para datos del representante",
    ],
    receiveLimitDayCop: 20_000_000,      // $20M COP/día (ventas rurales típicas)
    receiveLimitWeekCop: 50_000_000,     // $50M COP/semana
    withdrawLimitDayCop: 5_000_000,      // $5M COP/día
    withdrawHoldHours: 4,                // T+4h
    threeDsThresholdCop: 5_000_000,      // >$5M COP exige 3DS
  },
  3: {
    tier: 3,
    name: "Negocio verificado",
    description: "KYC completo. Selfie + cédula + biométrico.",
    badge: "Negocio verificado",
    requirements: [
      "Celular verificado",
      "Email confirmado",
      "Nombre completo",
      "Ciudad de operación",
      "Razón social",
      "NIT (validado por Verifik/RUES)",
      "DV del NIT (verificado)",
      "Consentimiento Ley 1581 para datos del representante",
      "Selfie del representante",
      "Cédula del representante (anverso y reverso)",
      "Validación biométrica (face match)",
    ],
    receiveLimitDayCop: 100_000_000,     // $100M COP/día
    receiveLimitWeekCop: 500_000_000,    // $500M COP/semana
    withdrawLimitDayCop: 20_000_000,     // $20M COP/día
    withdrawHoldHours: 0,                // T+0 hasta $5M, T+4h >$5M
    threeDsThresholdCop: Number.MAX_SAFE_INTEGER, // 3DS nunca (ya verificado)
  },
  4: {
    tier: 4,
    name: "Empresa verificada",
    description: "Empresa formal con RUT, cámara de comercio, estados financieros.",
    badge: "Empresa verificada",
    requirements: [
      "Celular verificado",
      "Email confirmado",
      "Nombre completo",
      "Ciudad de operación",
      "Razón social",
      "NIT (validado por Verifik/RUES)",
      "DV del NIT (verificado)",
      "Consentimiento Ley 1581 para datos del representante",
      "Selfie del representante",
      "Cédula del representante (anverso y reverso)",
      "Validación biométrica (face match)",
      "RUT actualizado (último año)",
      "Cámara de comercio (expedición <90 días)",
      "Estados financieros (último año)",
      "Certificación bancaria de cuenta",
    ],
    receiveLimitDayCop: 500_000_000,     // $500M COP/día
    receiveLimitWeekCop: Number.MAX_SAFE_INTEGER, // sin tope semanal
    withdrawLimitDayCop: Number.MAX_SAFE_INTEGER, // sin tope diario
    withdrawHoldHours: 0,                // T+0 siempre
    threeDsThresholdCop: Number.MAX_SAFE_INTEGER, // 3DS nunca
  },
};

/** Type guard: is `n` a valid Tier (0|1|2|3|4)? */
export function isValidTier(n: unknown): n is Tier {
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4;
}

/**
 * Whether a user can promote from `currentTier` to `targetTier`,
 * given a set of verified requirements (typically from Verifik + Cognito).
 */
export function canPromoteTo(
  currentTier: Tier,
  targetTier: Tier,
  verifiedRequirements: Set<string>,
): boolean {
  if (targetTier <= currentTier) return false;
  if (!isValidTier(targetTier)) return false;
  const target = TIERS[targetTier];
  return target.requirements.every((req) => verifiedRequirements.has(req));
}

/**
 * Returns the withdrawal hold (in hours) for a given tier + amount.
 * Tier 3 has special logic: T+0 up to $5M, T+4h above $5M.
 */
export function withdrawHoldFor(tier: Tier, amountCop: number): number {
  // Tier 3 special case: T+0 up to $5M COP, T+4h above $5M COP
  if (tier === 3 && amountCop > 5_000_000) return 4;
  return TIERS[tier].withdrawHoldHours;
}

/**
 * Whether 3DS is required for the given amount and tier.
 *
 * Convention: `threeDsThresholdCop` is the MAX amount that does NOT require 3DS.
 * Anything STRICTLY ABOVE the threshold requires 3DS.
 *
 * Tier 0 always requires 3DS (no KYC done — every card payment is high risk).
 */
export function requires3DS(tier: Tier, amountCop: number): boolean {
  if (tier === 0) return true; // always — special case for unverified users
  return amountCop > TIERS[tier].threeDsThresholdCop;
}