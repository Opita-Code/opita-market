/**
 * Security headers — shared module (frontend + API).
 *
 * PR 3 — closes MW-FE-004 (CSP) + OPL-API-008 (security headers).
 *
 * Used by:
 *   - apps/market-web/src/middleware.ts (Astro SSR)
 *   - packages/pagos-service/src/api/index.ts (Hono API)
 *
 * Headers set:
 *   - Strict-Transport-Security (HSTS)
 *   - X-Frame-Options: DENY (clickjacking protection)
 *   - X-Content-Type-Options: nosniff (MIME-sniffing protection)
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy: payment=(self), camera=(), microphone=(), etc.
 *   - Content-Security-Policy with Wompi allowlist
 *
 * NOTE: This is a shared module between Astro (apps/market-web) and the
 * Hono API (packages/pagos-service). For now, duplicated in both via
 * shared paths (apps/market-web/src/lib + packages/pagos-service/src/lib).
 */

export interface SecurityHeadersOptions {
  /** Production = strict HSTS + locked CSP. Dev = relaxed for HMR. */
  isProduction: boolean;
  /** Dev mode = Vite HMR websocket. Only relevant in dev. */
  isDev?: boolean;
  /** CSP nonce for inline scripts. */
  nonce?: string;
}

/** CSP allowlist of trusted origins (Wompi, Cognito, etc.). */
export const CSP_ALLOWLIST = {
  WOMPI_SCRIPT: "https://checkout.wompi.co",
  WOMPI_FRAME: "https://checkout.wompi.co",
  WOMPI_API: "https://production.wompi.co",
  COGNITO: "https://cognito-idp.us-east-1.amazonaws.com",
  SELF: "'self'",
};

/**
 * Build Content-Security-Policy header value.
 * Closes MW-FE-004.
 */
export function buildCspHeader(options: { nonce?: string; isDev?: boolean } = {}): string {
  const nonce = options.nonce ?? "";
  const isDev = options.isDev ?? false;

  // Default-src: only self by default
  // script-src: self + Wompi + (inline if nonce provided for hydration)
  // style-src: self + unsafe-inline (Astro injects styles) + Wompi
  // frame-src: Wompi for checkout iframe
  // img-src: self + data: + Wompi
  // connect-src: self + Wompi + Cognito + ws: (Vite HMR in dev)
  // frame-ancestors: 'none' (defense in depth alongside X-Frame-Options)
  // base-uri: 'self' (prevents <base> hijacking)
  // form-action: self (prevents form submission to attacker domains)
  // upgrade-insecure-requests: force HTTPS in production

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' ${CSP_ALLOWLIST.WOMPI_SCRIPT}${
      nonce ? ` 'nonce-${nonce}'` : ""
    }`,
    // 'unsafe-inline' for styles required for Astro's runtime CSS injection
    // and Wompi's inline styles. Tighten with hashes if Astro supports it.
    `style-src 'self' 'unsafe-inline' ${CSP_ALLOWLIST.WOMPI_FRAME}`,
    `frame-src ${CSP_ALLOWLIST.WOMPI_FRAME}`,
    `img-src 'self' data: blob: ${CSP_ALLOWLIST.WOMPI_FRAME}`,
    `connect-src 'self' ${CSP_ALLOWLIST.WOMPI_API} ${CSP_ALLOWLIST.COGNITO}${
      isDev ? " ws: http://localhost:*" : ""
    }`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];

  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

/**
 * Build complete set of security headers.
 * Closes OPL-API-008 (API side) + MW-FE-004 (CSP).
 */
export function buildSecurityHeaders(options: SecurityHeadersOptions): Record<string, string> {
  const csp = buildCspHeader({ nonce: options.nonce, isDev: options.isDev });

  return {
    "Strict-Transport-Security": options.isProduction
      ? "max-age=31536000; includeSubDomains; preload"
      : "max-age=3600", // 1 hour for dev/staging
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": [
      "payment=(self)",
      "camera=()",
      "microphone=()",
      "geolocation=(self)",
      "interest-cohort=()",
      "usb=()",
      "magnetometer=()",
      "accelerometer=()",
      "gyroscope=()",
    ].join(", "),
    "Content-Security-Policy": csp,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };
}
