import { describe, it, expect, beforeEach } from "vitest";
import {
  generateCsrfToken,
  validateCsrfToken,
  constantTimeEquals,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../src/lib/csrf.js";

/**
 * Tests for backend CSRF middleware (PR 6 — closes the loop started in PR 3).
 *
 * Spec: openspec/changes/opita-pagos-foundation/pentest-evidence
 *       /03-market-web-frontend.json (MW-FE-005)
 *       /04-recon-cve.json (CSRF middleware bypass via missing Content-Type)
 *
 * Backend responsibilities:
 *   - Set __csrf-token cookie (NOT HttpOnly — JS-readable) on GET responses
 *   - Validate X-CSRF-Token header matches cookie on POST/PUT/PATCH/DELETE
 *   - Reject mismatched tokens with 403 Forbidden
 *   - Use constant-time comparison (prevent timing attacks)
 *
 * Defense in depth:
 *   - SameSite=Strict session cookie (set by Cognito / SSO consumer)
 *   - Origin header check
 *   - Same-origin mode in fetch() calls
 */

describe("Backend CSRF middleware (closes PR 3 frontend loop)", () => {
  describe("generateCsrfToken", () => {
    it("returns 64-char hex string (32 bytes random)", () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns unique tokens on each call", () => {
      const t1 = generateCsrfToken();
      const t2 = generateCsrfToken();
      const t3 = generateCsrfToken();
      expect(t1).not.toBe(t2);
      expect(t2).not.toBe(t3);
      expect(t1).not.toBe(t3);
    });
  });

  describe("validateCsrfToken (constant-time comparison)", () => {
    it("returns true for matching tokens", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken(token, token)).toBe(true);
    });

    it("returns false for different tokens", () => {
      const t1 = generateCsrfToken();
      const t2 = generateCsrfToken();
      expect(validateCsrfToken(t1, t2)).toBe(false);
    });

    it("returns false for empty cookie", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken("", token)).toBe(false);
    });

    it("returns false for empty header", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken(token, "")).toBe(false);
    });

    it("returns false for both empty", () => {
      expect(validateCsrfToken("", "")).toBe(false);
    });

    it("returns false for different-length tokens (defense against length-leak)", () => {
      expect(validateCsrfToken("abc", "abcd")).toBe(false);
    });

    it("returns false for same-length but different content", () => {
      expect(validateCsrfToken("abc", "abd")).toBe(false);
    });

    it("constantTimeEquals returns true for identical strings", () => {
      expect(constantTimeEquals("hello", "hello")).toBe(true);
    });

    it("constantTimeEquals returns false for different-length", () => {
      expect(constantTimeEquals("hello", "helloo")).toBe(false);
    });
  });

  describe("Cookie + header name constants", () => {
    it("CSRF_COOKIE_NAME is __csrf-token (browser-readable, NOT HttpOnly)", () => {
      expect(CSRF_COOKIE_NAME).toBe("__csrf-token");
    });

    it("CSRF_HEADER_NAME is X-CSRF-Token (HTTP standard)", () => {
      expect(CSRF_HEADER_NAME).toBe("X-CSRF-Token");
    });
  });
});
