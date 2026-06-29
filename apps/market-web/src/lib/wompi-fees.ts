/**
 * Wompi fee disclosure (closes OPL-COMP-020, HIGH).
 *
 * SIC Circular 02/2022 prohibits hidden fees in payment flows. Users must
 * see the Wompi processing commission as a separate line item BEFORE
 * redirecting to the widget, so they consent to the full amount they'll
 * be charged.
 *
 * Fees below are the publicly published Wompi Colombia rates (2024-2026).
 * They are merchant-of-record (Opita pays Wompi); end users see the
 * commission that Wompi charges the merchant for processing the payment.
 * Display in checkout:
 *   - "Incluye COP X de comisión por procesamiento de pago."
 *
 * Operator: when the merchant agreement with Wompi changes (volume
 * discount, custom rate), update the constants below. No backend change
 * needed — the fee is computed client-side at render time.
 */

export type WompiChannelForFee = "CARD" | "PSE" | "NEQUI" | "DAVIPLATA" | "BREB";

export interface WompiFeeBreakdown {
  /** Fixed component in COP (e.g. COP 900 per card tx) */
  fixedCop: number;
  /** Variable component as a fraction of the amount (e.g. 0.0299 for 2.99%) */
  variableRate: number;
  /** Human-readable fee label, e.g. "2.99% + COP 900" */
  label: string;
}

/**
 * Public Wompi Colombia rates (2024-2026 standard).
 *
 * Source: docs.wompi.co (publicly published) + Wompi sales team
 * confirmation. If the operator's agreement includes volume discounts,
 * override the constant for that channel.
 */
export const WOMPI_FEES: Record<WompiChannelForFee, WompiFeeBreakdown> = {
  CARD: { fixedCop: 900, variableRate: 0.0299, label: "2.99% + COP 900" },
  PSE: { fixedCop: 2500, variableRate: 0, label: "COP 2.500 fijo" },
  NEQUI: { fixedCop: 1500, variableRate: 0, label: "COP 1.500 fijo" },
  DAVIPLATA: { fixedCop: 1500, variableRate: 0, label: "COP 1.500 fijo" },
  BREB: { fixedCop: 0, variableRate: 0, label: "Sin costo" },
};

/**
 * Map a WOMPI_* intent channel to the fee lookup key.
 * Defaults to CARD for any unknown / future channel so the disclosure
 * still shows a number (worst-case overestimate is acceptable for
 * compliance; the merchant absorbs the actual cost).
 */
export function feeKeyForChannel(
  channel: string,
): WompiChannelForFee {
  const upper = channel.toUpperCase();
  if (upper === "WOMPI_PSE") return "PSE";
  if (upper === "WOMPI_NEQUI") return "NEQUI";
  if (upper === "WOMPI_DAVIPLATA") return "DAVIPLATA";
  if (upper === "WOMPI_BREB") return "BREB";
  return "CARD"; // WOMPI_CARD or unknown → default to card rate
}

/**
 * Compute the Wompi commission in COP for a given amount + channel.
 *   fee = round(amount_cop * variableRate) + fixedCop
 * Uses Math.round (no fractional COP) and always returns a non-negative
 * integer. For Bre-B, returns 0 (no fee for the user).
 */
export function computeWompiFee(amountCop: number, channel: string): number {
  if (!Number.isFinite(amountCop) || amountCop <= 0) return 0;
  const fee = WOMPI_FEES[feeKeyForChannel(channel)];
  const variable = Math.round(amountCop * fee.variableRate);
  return Math.max(0, variable + fee.fixedCop);
}

/**
 * Display string for the checkout line item.
 * Format: "Incluye COP X de comisión por procesamiento de pago."
 * Returns empty string when the fee is 0 (Bre-B), so the caller can
 * conditionally render the line.
 */
export function formatFeeDisclosure(
  amountCop: number,
  channel: string,
): string {
  const fee = computeWompiFee(amountCop, channel);
  if (fee === 0) return "";
  const formatted = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(fee);
  return `Incluye ${formatted} de comisión por procesamiento de pago.`;
}

/**
 * Total amount including Wompi fee (what the user actually pays).
 * For Bre-B: total === amount. For others: total === amount + fee.
 *
 * NOTE: In Opita's current model, the MERCHANT (Opita) absorbs the Wompi
 * fee — the user pays only the product amount via the closed-loop wallet.
 * This helper exists for the future case where the fee is passed to the
 * user (e.g. card top-ups). For wallet top-ups via Wompi, the user
 * currently pays only `amountCop` and the fee is logged separately.
 */
export function totalWithFee(amountCop: number, channel: string): number {
  return amountCop + computeWompiFee(amountCop, channel);
}
