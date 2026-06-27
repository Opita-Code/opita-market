/**
 * Device fingerprint collection (PR 7 — closes OPL-CARD-013).
 *
 * Uses FingerprintJS open-source (MIT) to compute a stable visitorId from
 * browser attributes (canvas, audio, fonts, screen, etc). The visitorId
 * is sent as a header on the intent API call so the fraud engine's
 * DEVICE_CARD velocity counter and DEVICE_FINGERPRINT_MISMATCH signal
 * can fire through the primary attack surface.
 *
 * SSR-safe: returns null when window is undefined (server-side rendering).
 * The component should skip the device_id header when null.
 *
 * SECURITY:
 *   - visitorId is a HASH, not raw browser attributes — no PII leak.
 *   - It is intentionally NOT a true fingerprint (FingerprintJS open-source
 *     has lower entropy than the Pro version). The goal is to detect
 *     "same browser re-used across accounts", not to identify individuals.
 *   - The hash is sent over HTTPS (TLS) — never logged.
 */

import FingerprintJS, { type GetResult } from "@fingerprintjs/fingerprintjs";

export type FingerprintJsResult = GetResult;

let cachedVisitorId: string | null = null;
let loadPromise: Promise<string | null> | null = null;

/**
 * Compute the device fingerprint (cached after first call).
 *
 * Returns:
 *   - string: the visitorId from FingerprintJS (browser context)
 *   - null: in SSR or if FingerprintJS fails to load
 *
 * The result is cached for the lifetime of the page to avoid re-running
 * the fingerprint on every API call.
 */
export async function computeDeviceFingerprint(): Promise<string | null> {
  // SSR guard — no window means no browser
  if (typeof window === "undefined") {
    return null;
  }

  // Return cached value
  if (cachedVisitorId !== null) {
    return cachedVisitorId;
  }

  // Dedupe concurrent loads (multiple components may call at once)
  if (loadPromise === null) {
    loadPromise = (async () => {
      try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        cachedVisitorId = result.visitorId;
        return cachedVisitorId;
      } catch {
        // FingerprintJS failed to load (e.g., privacy mode, browser restriction).
        // Return null — backend will treat missing device_id as fraud signal trigger.
        cachedVisitorId = null;
        return null;
      }
    })();
  }

  return loadPromise;
}

/**
 * Reset the cached fingerprint (for testing).
 */
export function _resetDeviceFingerprintCache(): void {
  cachedVisitorId = null;
  loadPromise = null;
}
