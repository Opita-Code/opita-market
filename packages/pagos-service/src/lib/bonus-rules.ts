/**
 * Bonus rules — config-driven registry.
 *
 * THIS FILE IS THE SOURCE OF TRUTH for all bonus amounts, cooldowns, and
 * multipliers. Adding a new bonus rule = add an entry to BONUS_RULES.
 *
 * Cooldowns prevent abuse:
 *   - DAILY_LOGIN: 24h (prevents multi-claim per day)
 *   - STREAK_7_DAYS / STREAK_30_DAYS: 7d / 30d (one-shot per cycle)
 *   - REFERRAL_QUALIFIED: 7d (prevents same-referee cycling)
 *   - others: 0 (every qualifying action triggers)
 *
 * Multipliers:
 *   - Default 1.0
 *   - Multipliers are applied at trigger time (e.g., tier-based 1.05x, 1.10x)
 *   - This file stores the BASE amount; multiplier is computed by the engine.
 */

import type { BonusRuleId } from "../db/tables.js";

export interface BonusRuleConfig {
  id: BonusRuleId;
  name: string;
  description: string;
  amountCop: number;
  cooldownSeconds: number;
  /** Base multiplier (1.0 unless bonus is part of a tiered campaign). */
  multiplier: number;
  /** If true, this bonus is reversed when the originating transaction is refunded. */
  reversalOnChargeback: boolean;
  /** PR 2d — Daily cap fields (closes OPL-LIB-003, OPL-CARD-005, OPL-CARD-011). */
  /** Max claims per user per day (undefined = no claim cap). */
  maxClaimsPerDay?: number;
  /** Max cumulative COP per user per day from this rule (undefined = no amount cap). */
  maxAmountPerDayCop?: number;
}

export const BONUS_RULES: Record<BonusRuleId, BonusRuleConfig> = {
  WELCOME_CELL_VERIFIED: {
    id: "WELCOME_CELL_VERIFIED",
    name: "Bienvenida — celular verificado",
    description: "Gift al verificar el número de celular (reciprocidad inicial)",
    amountCop: 200,
    cooldownSeconds: 0, // one-shot via "already claimed" check, not cooldown
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  EMAIL_VERIFIED: {
    id: "EMAIL_VERIFIED",
    name: "Email verificado",
    description: "Recompensa al confirmar el correo electrónico",
    amountCop: 100,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  PROFILE_COMPLETED: {
    id: "PROFILE_COMPLETED",
    name: "Perfil completo",
    description: "Recompensa al completar foto + bio + ciudad",
    amountCop: 100,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  NIT_VERIFIED: {
    id: "NIT_VERIFIED",
    name: "NIT verificado",
    description: "Recompensa al validar el NIT vía Verifik/RUES",
    amountCop: 1000,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  KYC_COMPLETED: {
    id: "KYC_COMPLETED",
    name: "KYC completo",
    description: "Recompensa al completar verificación de identidad Tier 3",
    amountCop: 5000,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  FIRST_PURCHASE_CASHBACK: {
    id: "FIRST_PURCHASE_CASHBACK",
    name: "Cashback primera compra",
    description: "3% de cashback en la primera compra del usuario",
    amountCop: 0, // computed as % of transaction
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: true,
    // PR 2d — daily caps
    maxClaimsPerDay: 1,
    maxAmountPerDayCop: 100_000,
  },
  PURCHASE_CASHBACK: {
    id: "PURCHASE_CASHBACK",
    name: "Cashback por compra",
    description: "2% de cashback en cada compra aprobada",
    amountCop: 0, // computed as % of transaction
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: true,
    // PR 2d — daily caps (closes OPL-LIB-003 + OPL-CARD-011)
    maxClaimsPerDay: 20,
    maxAmountPerDayCop: 100_000,
  },
  SELLER_FIRST_SALE: {
    id: "SELLER_FIRST_SALE",
    name: "Vendedor — primera venta",
    description: "Recompensa al vendedor por su primera venta exitosa",
    amountCop: 500,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: true, // if first sale refunded, bonus reversed
  },
  SELLER_REPEAT_SALE: {
    id: "SELLER_REPEAT_SALE",
    name: "Vendedor — venta recurrente",
    description: "Recompensa por cada venta subsecuente",
    amountCop: 100,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: true,
  },
  REVIEW_LEFT: {
    id: "REVIEW_LEFT",
    name: "Reseña dejada",
    description: "Recompensa por reseña verificada de compra (1 por producto)",
    amountCop: 50,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: false, // bonus is for the review action, not the purchase
  },
  REFERRAL_QUALIFIED: {
    id: "REFERRAL_QUALIFIED",
    name: "Referido calificado",
    description: "Recompensa al referente cuando el referido completa primera compra",
    amountCop: 500,
    cooldownSeconds: 7 * 24 * 60 * 60, // 7 days per referral cycle
    multiplier: 1.0,
    reversalOnChargeback: true,
  },
  REFERRAL_SIGNED_UP: {
    id: "REFERRAL_SIGNED_UP",
    name: "Referido registrado",
    description: "Recompensa al referido al registrarse con código",
    amountCop: 200,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: true,
  },
  DAILY_LOGIN: {
    id: "DAILY_LOGIN",
    name: "Login diario",
    description: "Recompensa por login diario (cap 50/semana)",
    amountCop: 5,
    cooldownSeconds: 24 * 60 * 60,
    multiplier: 1.0,
    reversalOnChargeback: false,
    maxClaimsPerDay: 1,  // PR 2d — prevent login-spam farming
  },
  STREAK_7_DAYS: {
    id: "STREAK_7_DAYS",
    name: "Racha 7 días",
    description: "Bonus por racha de 7 días consecutivos",
    amountCop: 50,
    cooldownSeconds: 7 * 24 * 60 * 60, // one-shot per 7-day cycle
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  STREAK_30_DAYS: {
    id: "STREAK_30_DAYS",
    name: "Racha 30 días",
    description: "Bonus por racha de 30 días consecutivos",
    amountCop: 500,
    cooldownSeconds: 30 * 24 * 60 * 60, // one-shot per 30-day cycle
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  BIRTHDAY: {
    id: "BIRTHDAY",
    name: "Cumpleaños",
    description: "Bonus en el día del cumpleaños",
    amountCop: 500,
    cooldownSeconds: 365 * 24 * 60 * 60,
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  ANNIVERSARY: {
    id: "ANNIVERSARY",
    name: "Aniversario de cuenta",
    description: "Bonus cada año de antigüedad de cuenta",
    amountCop: 200,
    cooldownSeconds: 365 * 24 * 60 * 60,
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
  RURAL_HUILA_CHALLENGE: {
    id: "RURAL_HUILA_CHALLENGE",
    name: "Reto Huila Rural",
    description: "Multiplicador 2x para productos del Huila en challenge activo",
    amountCop: 0, // multiplier-only rule
    cooldownSeconds: 0,
    multiplier: 2.0,
    reversalOnChargeback: true,
  },
  BLACK_FRIDAY_OPITA: {
    id: "BLACK_FRIDAY_OPITA",
    name: "Black Friday Opita",
    description: "Multiplicador 5x cashback durante Black Friday Opita",
    amountCop: 0,
    cooldownSeconds: 0,
    multiplier: 5.0,
    reversalOnChargeback: true,
  },
  TIER_PROMOTION_BONUS: {
    id: "TIER_PROMOTION_BONUS",
    name: "Bonus por subir de tier",
    description: "Recompensa one-shot al subir de tier",
    amountCop: 200,
    cooldownSeconds: 0,
    multiplier: 1.0,
    reversalOnChargeback: false,
  },
};

/** Returns the rule config for a given rule id, or throws if unknown. */
export function getRule(id: BonusRuleId): BonusRuleConfig {
  const rule = BONUS_RULES[id];
  if (!rule) {
    throw new Error(`Unknown bonus rule: ${id}`);
  }
  return rule;
}

/** Convenience accessor for cooldown (seconds). */
export function getCooldownSeconds(id: BonusRuleId): number {
  return getRule(id).cooldownSeconds;
}

/**
 * Compute the actual bonus amount for a rule, given an optional transaction amount.
 *   - For PERCENT rules (amountCop=0), pass amountInCents to compute percentage.
 *   - For FIXED rules, returns the rule's amountCop × multiplier.
 *   - For MULTIPLIER-ONLY rules (RURAL_HUILA_CHALLENGE), returns 0 (caller handles).
 */
export function computeBonusAmount(
  id: BonusRuleId,
  context: { transactionAmountCop?: number; userMultiplier?: number },
): number {
  const rule = getRule(id);
  const userMultiplier = context.userMultiplier ?? 1.0;

  if (rule.amountCop > 0) {
    // Fixed amount × user multiplier
    return Math.round(rule.amountCop * userMultiplier);
  }

  // Percentage rules
  if (context.transactionAmountCop === undefined) return 0;

  switch (id) {
    case "FIRST_PURCHASE_CASHBACK":
      return Math.round(context.transactionAmountCop * 0.03);
    case "PURCHASE_CASHBACK":
      return Math.round(context.transactionAmountCop * 0.02);
    default:
      // Multiplier-only rules (RURAL_HUILA_CHALLENGE, BLACK_FRIDAY_OPITA) — caller handles
      return 0;
  }
}