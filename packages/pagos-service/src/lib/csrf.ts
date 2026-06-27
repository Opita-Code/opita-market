/**
 * Backend CSRF token — validation + token generation.
 *
 * PR 6 — closes the loop started by PR 3 frontend (MW-FE-005).
 *
 * Pattern: double-submit cookie.
 *   1. Backend sets `__csrf-token` cookie (NOT HttpOnly) on GET responses.
 *   2. Client reads cookie via document.cookie and sends as X-CSRF-Token
 *      header on state-mutating requests (POST, PUT, PATCH, DELETE).
 *   3. Backend validates header matches cookie (constant-time compare).
 *
 * Why double-submit (not session-bound):
 *   - Works without server-side session storage.
 *   - SameSite=Strict session cookie already protects against CSRF on
 *     top-level navigation; this adds defense for fetch() from subdomains
 *     and explicit sub-attacks (CSRF via leaked forms).
 *
 * Defense in depth (per pentest OPL-COMP-008 remediation):
 *   - SameSite=Strict session cookie (set by Cognito/SSO consumer)
 *   - X-CSRF-Token + cookie match (this module)
 *   - Origin header check (separate middleware)
 */

import { randomBytes } from "node:crypto";

/** Cookie name (browser-readable, NOT HttpOnly). */
export const CSRF_COOKIE_NAME = "__csrf-token";

/** Header name (HTTP standard X-CSRF-Token). */
export const CSRF_HEADER_NAME = "X-CSRF-Token";

/** Cookie attributes for __csrf-token. */
export const CSRF_COOKIE_ATTRS =
  "Path=/; SameSite=Strict; Secure; HttpOnly=false";

/** Methods that require CSRF validation. */
export const STATE_MUTATING_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/** Token length: 32 bytes = 64 hex chars = 256 bits of entropy. */
const TOKEN_BYTES = 32;

/**
 * Generate a cryptographically random CSRF token (32 bytes hex).
 * Uses Node crypto.randomBytes (NOT Math.random — predictable).
 */
export function generateCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Constant-time string equality.
 * Prevents timing attacks that could leak token length or content.
 *
 * For different lengths: returns false in O(1) (does NOT iterate).
 * For same length: iterates all chars with bitwise OR accumulator.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  // Length check first (length is not secret — well-known size)
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Validate CSRF token (constant-time comparison).
 *
 * @param cookieToken — value from `__csrf-token` cookie
 * @param headerToken — value from `X-CSRF-Token` header
 * @returns true if both tokens are non-empty and match exactly
 */
export function validateCsrfToken(
  cookieToken: string | undefined | null,
  headerToken: string | undefined | null,
): boolean {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== headerToken.length) return false;
  return constantTimeEquals(cookieToken, headerToken);
}

/**
 * Parse __csrf-token from a Cookie header string.
 * Returns null if not present or malformed.
 */
export function parseCsrfCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const eqIdx = cookie.indexOf("=");
    if (eqIdx < 0) continue;
    const name = cookie.slice(0, eqIdx).trim();
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(cookie.slice(eqIdx + 1));
    }
  }
  return null;
}
