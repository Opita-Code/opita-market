/**
 * HTTP error mapper — converts typed OpitaPagosError → JSON Response with status.
 *
 * Also maps common client errors (SyntaxError from c.req.json, etc.) to 400
 * so malformed input doesn't return 500 (which would cause Wompi retry
 * loops and Lambda concurrency exhaustion). Closes OPL-DEP-001.
 */
import type { Context } from "hono";
import { OpitaPagosError } from "./errors.js";

export function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof OpitaPagosError) {
    return {
      status: err.httpStatus,
      body: { error_code: err.code, message: err.safeMessage },
    };
  }
  // Common client-side errors → 400 (not 500)
  if (err instanceof SyntaxError) {
    return {
      status: 400,
      body: { error_code: "INVALID_JSON", message: "Request body is not valid JSON" },
    };
  }
  if (err instanceof TypeError && /Cannot read|undefined|null/.test(err.message)) {
    return {
      status: 400,
      body: { error_code: "INVALID_INPUT", message: "Invalid request structure" },
    };
  }
  // Unknown error → 500 (real internal error)
  // Do NOT leak err.message — it may contain internal info
  return {
    status: 500,
    body: { error_code: "INTERNAL_ERROR", message: "Internal error" },
  };
}

/**
 * Wrapper that catches typed errors in route handlers.
 */
export function handleError(err: unknown, c: Context): Response {
  const { status, body } = errorToResponse(err);
  return c.json(body, status as 400 | 401 | 402 | 403 | 404 | 409 | 422 | 500);
}