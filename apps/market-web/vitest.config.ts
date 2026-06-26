import { defineConfig } from "vitest/config";

/**
 * Vitest config for market-web. Excludes the Playwright E2E suite
 * (`e2e/*.spec.ts`) — Playwright has its own runner and global
 * `test.describe` / `test()` symbols that collide with Vitest's API.
 *
 * Use `npm run test:e2e` (Playwright) for the legal-pages compliance
 * suite; `npm test` (Vitest) for any future unit tests under `src/`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    environment: "node",
  },
});