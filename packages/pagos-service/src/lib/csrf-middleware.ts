/**
 * Hono middleware: CSRF validation (PR 6 — closes MW-FE-005 loop).
 *
 * Implements double-submit cookie validation:
 *   - On GET/HEAD/OPTIONS: set `__csrf-token` cookie (if not present).
 *   - On POST/PUT/PATCH/DELETE: validate X-CSRF-Token matches cookie.
 *
 * Applied after authMiddleware so authenticated requests get the
 * validation. Health endpoint is exempt (no auth, no state mutation).
 *
 * Order of middleware in api/index.ts:
 *   1. securityHeadersMiddleware (PR 3 — closes OPL-API-008)
 *   2. CSRF middleware (PR 6 — closes MW-FE-005 backend loop)
 *   3. authMiddleware (for /v1/*)
 *   4. route handlers
 */

import type { Context, MiddlewareHandler } from "hono";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_COOKIE_ATTRS,
  STATE_MUTATING_METHODS,
  generateCsrfToken,
  parseCsrfCookie,
  validateCsrfToken,
} from "./csrf.js";

const CSRF_HEADER = "content-type";
const JSON_CONTENT_TYPE = "application/json";

/**
 * CSRF middleware. Sets cookie on safe methods, validates on mutating methods.
 *
 * Bypass conditions (designed to fail-CLOSED by default):
 *   - Health endpoint (/health) — no state mutation, no auth
 *   - Webhook endpoint (/v1/payments/webhook) — Wompi-signed, not browser
 *
 * NOTE: For simplicity, this middleware reads/writes the raw Cookie header
 * directly. In a Hono app, you can use the Cookie helper, but the cookie
 * must be JS-readable (NOT HttpOnly) so the client can send it back as
 * a header.
 */
export const csrfMiddleware: MiddlewareHandler = async (c: Context, next) => {
  const path = c.req.path;
  const method = c.req.method.toUpperCase();

  // Bypass: health endpoint (no state mutation)
  if (path === "/health") {
    return next();
  }

  // Bypass: webhooks (signed via Wompi signature, not browser session)
  if (path === "/v1/payments/webhook") {
    return next();
  }

  // Read existing CSRF cookie
  const cookieHeader = c.req.header("cookie") ?? null;
  const existingCsrf = parseCsrfCookie(cookieHeader);

  if (STATE_MUTATING_METHODS.has(method)) {
    // Validate: X-CSRF-Token header must match __csrf-token cookie
    const headerToken = c.req.header(CSRF_HEADER_NAME) ?? null;

    if (!validateCsrfToken(existingCsrf, headerToken)) {
      return c.json(
        {
          error_code: "CSRF_VALIDATION_FAILED",
          message: "CSRF token missing or invalid",
        },
        403,
      );
    }
    // Token valid — proceed
    return next();
  }

  // Safe method (GET, HEAD, OPTIONS): set cookie if not present
  await next();
  if (!existingCsrf) {
    const newToken = generateCsrfToken();
    c.header(
      "Set-Cookie",
      `${CSRF_COOKIE_NAME}=${newToken}; ${CSRF_COOKIE_ATTRS}; Max-Age=86400`,
      { append: true },
    );
  }
  return;
};

/**
 * Detect content-type for additional CSRF protection (per pentest recon CVE).
 * POST/PUT/PATCH without `Content-Type: application/json` or `application/x-www-form-urlencoded`
 * may indicate a CSRF probe (browsers always set Content-Type on form submissions).
 *
 * NOTE: This is a defense-in-depth signal, not a hard requirement — APIs may accept
 * multiple content types. For maximum strictness, reject requests without
 * Content-Type header on state-mutating methods.
 */
export function hasValidContentType(c: Context, method: string): boolean {
  if (!STATE_MUTATING_METHODS.has(method.toUpperCase())) return true;
  const ct = c.req.header(CSRF_HEADER)?.toLowerCase() ?? "";
  return (
    ct.startsWith(JSON_CONTENT_TYPE) ||
    ct.startsWith("application/x-www-form-urlencoded") ||
    ct.startsWith("multipart/form-data")
  );
}
