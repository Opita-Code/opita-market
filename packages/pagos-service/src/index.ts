/**
 * Lambda entry point for Opita Pagos.
 *
 * Re-exports the handler from src/api/index.ts which contains the full
 * Hono application with all routes mounted under /v1/...
 *
 * SST v4 binding: `handler: "packages/pagos-service/src/api/index.handler"`
 */
export { handler } from "./api/index.js";
