import { describe, it, expect } from "vitest";
import {
  buildSecurityHeaders,
  buildCspHeader,
  CSP_ALLOWLIST,
} from "../lib/security-headers.js";

/**
 * Tests for PR 3 — security headers middleware (frontend + API).
 *
 * Closes:
 *   - MW-FE-004 (CSP headers)
 *   - OPL-API-008 (HSTS, X-Frame-Options, X-Content-Type-Options,
 *                 Referrer-Policy, Permissions-Policy)
 */

describe("PR 3 — security headers (closes MW-FE-004, OPL-API-008)", () => {
  it("HSTS: max-age=31536000; includeSubDomains; preload", () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
  });

  it("X-Frame-Options: DENY (prevents clickjacking)", () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("X-Content-Type-Options: nosniff (prevents MIME-sniffing)", () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("Referrer-Policy: strict-origin-when-cross-origin", () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("Permissions-Policy restricts payment to self", () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    expect(headers["Permissions-Policy"]).toContain("payment=(self)");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
  });

  it("includes CSP header with Wompi allowlist", () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    expect(headers["Content-Security-Policy"]).toBeDefined();
    expect(headers["Content-Security-Policy"]).toContain("frame-src https://checkout.wompi.co");
    expect(headers["Content-Security-Policy"]).toContain("script-src");
  });

  it("CSP header is well-formed (has all required directives)", () => {
    const csp = buildCspHeader();
    expect(csp).toContain("default-src");
    expect(csp).toContain("script-src");
    expect(csp).toContain("style-src");
    expect(csp).toContain("frame-src");
    expect(csp).toContain("img-src");
    expect(csp).toContain("connect-src");
  });

  it("CSP blocks unsafe-inline by default for scripts (uses nonce)", () => {
    const csp = buildCspHeader({ nonce: "abc123" });
    // script-src must not contain unsafe-inline (only style-src does for Astro CSS)
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'nonce-abc123'");
  });

  it("CSP allows Wompi frame and script sources", () => {
    const csp = buildCspHeader();
    expect(csp).toContain(CSP_ALLOWLIST.WOMPI_FRAME);
    expect(csp).toContain(CSP_ALLOWLIST.WOMPI_SCRIPT);
  });

  it("in dev mode, HSTS is shorter (1 hour for testing)", () => {
    const headers = buildSecurityHeaders({ isProduction: false });
    expect(headers["Strict-Transport-Security"]).toBe("max-age=3600");
  });

  it("in dev mode, CSP allows Vite HMR websocket", () => {
    const headers = buildSecurityHeaders({ isProduction: false, isDev: true });
    expect(headers["Content-Security-Policy"]).toContain("ws:");
    expect(headers["Content-Security-Policy"]).toContain("http://localhost:*");
  });
});

describe("PR 3 — Wompi SRI (closes MW-FE-002)", () => {
  it("isValidSriHash validates correctly", async () => {
    const { isValidSriHash } = await import("../lib/wompi-sri.js");
    // Valid sha384: 88 base64 chars
    expect(isValidSriHash("sha384-" + "A".repeat(86))).toBe(true);
    // Invalid: too short
    expect(isValidSriHash("sha384-short")).toBe(false);
    // Invalid: missing prefix
    expect(isValidSriHash("A".repeat(86))).toBe(false);
  });

  it("wompiWidgetIntegrity returns full integrity string", async () => {
    const { wompiWidgetIntegrity, WOMPI_SRI_HASH } = await import("../lib/wompi-sri.js");
    expect(wompiWidgetIntegrity()).toBe(WOMPI_SRI_HASH);
  });
});

describe("PR 3 — CSRF token (closes MW-FE-005)", () => {
  it("generateCsrfToken returns 64-char hex string", async () => {
    const { generateCsrfToken } = await import("../lib/csrf-token.js");
    const token = generateCsrfToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generateCsrfToken returns unique tokens on each call", async () => {
    const { generateCsrfToken } = await import("../lib/csrf-token.js");
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });

  it("constantTimeEquals returns true for matching strings", async () => {
    const { constantTimeEquals } = await import("../lib/csrf-token.js");
    expect(constantTimeEquals("abc", "abc")).toBe(true);
  });

  it("constantTimeEquals returns false for different strings", async () => {
    const { constantTimeEquals } = await import("../lib/csrf-token.js");
    expect(constantTimeEquals("abc", "abd")).toBe(false);
  });

  it("constantTimeEquals returns false for different lengths", async () => {
    const { constantTimeEquals } = await import("../lib/csrf-token.js");
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
  });

  it("validateCsrfToken accepts matching token (constant-time)", async () => {
    const { generateCsrfToken, validateCsrfToken } = await import("../lib/csrf-token.js");
    const token = generateCsrfToken();
    expect(validateCsrfToken(token, token)).toBe(true);
  });

  it("validateCsrfToken rejects mismatched token", async () => {
    const { generateCsrfToken, validateCsrfToken } = await import("../lib/csrf-token.js");
    const token1 = generateCsrfToken();
    const token2 = generateCsrfToken();
    expect(validateCsrfToken(token1, token2)).toBe(false);
  });
});
