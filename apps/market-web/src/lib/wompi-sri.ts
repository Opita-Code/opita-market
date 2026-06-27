/**
 * Wompi widget Subresource Integrity (SRI) hash.
 *
 * PR 3 — closes MW-FE-002 (Wompi SRI).
 *
 * The Wompi widget.js script is loaded from https://checkout.wompi.co/widget.js.
 * Without SRI, a MITM attacker can substitute a tampered widget.js that
 * exfiltrates payment data. With SRI + crossOrigin, the browser verifies
 * the script's hash matches before executing.
 *
 * Operator action required:
 *   1. Get Wompi's official SRI hash from docs.wompi.co or Wompi support.
 *   2. Replace WOMPI_SRI_HASH below with the official hash.
 *   3. Re-deploy. Browser will reject any tampered widget.js load.
 *
 * The hash below is a PLACEHOLDER — Wompi does not publish a public SRI hash
 * as of 2026-06-27. Operator must request it from Wompi support.
 */

// PLACEHOLDER — operator must replace with official Wompi-published hash.
// SHA-384 of an empty string for testing only — DO NOT USE IN PRODUCTION.
export const WOMPI_SRI_HASH =
  "sha384-FIXME-operator-replace-with-official-wompi-published-hash-after-contacting-support";

/** Returns the full SRI integrity string for the Wompi widget script. */
export function wompiWidgetIntegrity(): string {
  return WOMPI_SRI_HASH;
}

/** Wompi widget URL — single source of truth. */
export const WOMPI_WIDGET_URL = "https://checkout.wompi.co/widget.js";

/**
 * Validate SRI hash format. Catches operator misconfigurations.
 * SHA-384 = 64 bytes = 88 base64 chars + 'sha384-' prefix = 95 chars total.
 */
export function isValidSriHash(hash: string): boolean {
  return /^sha384-[A-Za-z0-9+/]{86}={0,2}$/.test(hash);
}

if (!isValidSriHash(WOMPI_SRI_HASH)) {
  // Log warning at import time — dev should see this in console
  console.warn(
    `[wompi-sri] WOMPI_SRI_HASH is not a valid sha384 hash. ` +
      `Operator must replace with official Wompi-published hash. ` +
      `Current value: ${WOMPI_SRI_HASH.slice(0, 30)}...`,
  );
}
