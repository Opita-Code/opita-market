/**
 * HTTP error mapper — converts typed OpitaPagosError → JSON Response with status.
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
  const message = err instanceof Error ? err.message : String(err);
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