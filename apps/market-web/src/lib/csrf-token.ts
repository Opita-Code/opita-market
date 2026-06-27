/**
 * CSRF token — double-submit cookie pattern.
 *
 * PR 3 — closes MW-FE-005 (CSRF protection on state-mutating requests).
 *
 * Pattern:
 *   1. Backend sets `__csrf-token` cookie (NOT HttpOnly — JS-readable) on
 *      any GET request. Token is 64-char random hex.
 *   2. Client reads cookie via document.cookie and sends as X-CSRF-Token
 *      header on state-mutating requests (POST, PUT, DELETE, PATCH).
 *   3. Backend validates X-CSRF-Token matches the cookie value (constant-time).
 *
 * Defense in depth:
 *   - SameSite=Strict session cookie (set by Cognito / SSO consumer)
 *   - Origin header check on backend
 *   - Same-origin mode in fetch() calls
 */

/** Generate a 64-char hex CSRF token (32 bytes random). */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string equality.
 * Prevents timing attacks that could leak token length or content.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Validate CSRF token (constant-time comparison).
 * Returns true if both tokens match exactly.
 */
export function validateCsrfToken(cookieToken: string, headerToken: string): boolean {
  if (!cookieToken || !headerToken) return false;
  return constantTimeEquals(cookieToken, headerToken);
}

/** CSRF cookie name. */
export const CSRF_COOKIE_NAME = "__csrf-token";

/** CSRF header name. */
export const CSRF_HEADER_NAME = "X-CSRF-Token";

/**
 * Read CSRF token from cookies. Browser-readable only (NOT HttpOnly).
 */
export function readCsrfTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split("=");
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}
