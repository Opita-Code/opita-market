/**
 * Lambda entry point for Opita Pagos.
 *
 * This file is intentionally minimal in PR 1 (Foundation).
 * The Hono app + hono/aws-lambda handle() wrapper lands in PR 6.
 * See openspec/changes/opita-pagos-foundation/tasks.md.
 */

// PR 1 — Foundation. PR 6 will export: `export const handler = handle(app)`.
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return {
    statusCode: 503,
    body: JSON.stringify({ error_code: "NOT_IMPLEMENTED", message: "PagosAPI bootstraps in PR 6" }),
  };
};