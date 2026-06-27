/**
 * Dev-bypass via explicit flag — closes OPL-LIB-005 + MW-FE-003.
 *
 * Production deployments MUST NOT set DEV_AUTH_ENABLED.
 * Lambda default has NODE_ENV=undefined, so the old `NODE_ENV !== "production"`
 * check was fail-open. We require an EXPLICIT 'true' string match.
 */

export const DEV_AUTH_FLAG = "DEV_AUTH_ENABLED";

export function isDevBypassEnabled(): boolean {
  return process.env[DEV_AUTH_FLAG] === "true";
}
