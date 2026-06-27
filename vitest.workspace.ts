/**
 * Vitest workspace config — picks up per-package configs.
 *
 * Without this, `npx vitest run` from the root uses no config and falls back
 * to the default `environment: "node"`, which makes React component tests
 * fail with "ReferenceError: document is not defined".
 *
 * With this workspace, vitest finds each package's vitest.config.ts and
 * uses the right environment (jsdom for market-web, node for pagos-service).
 */
export default [
  "packages/pagos-service",
  "apps/market-web",
  "packages/compliance-service",
];
