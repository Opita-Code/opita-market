/**
 * Playwright config for market-web E2E (compliance-foundation PR 4 task 4.5).
 *
 * Boots `astro dev` on port 4321, injects `JWT_SECRET` so the real
 * `cognito-sso-consumer` code path validates the dev JWT (no shortcuts),
 * and runs the `e2e/` suite against the SSR output.
 *
 * Web server reuse: `reuseExistingServer` keeps the dev server warm
 * across local re-runs to avoid the slow Astro cold start on each test.
 */

import { defineConfig, devices } from "@playwright/test";
import { DEV_JWT_SECRET } from "./e2e/fixtures/dev-jwt.js";

const PORT = Number(process.env.E2E_PORT ?? 4322);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Match the original Vitest config: keep E2E in its own lane and don't
  // glob unit tests under src/.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `astro dev` is fast enough but the cold start (~3s) plus JIT
    // builds justifies the timeout.
    command: `npx astro dev --port ${PORT} --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Force the production JWT code path with a fixed dev secret
      // so the e2e fixture (e2e/fixtures/dev-jwt.ts) can sign matching
      // tokens. NODE_ENV stays unset so the dev override stays off.
      JWT_SECRET: DEV_JWT_SECRET,
      // Silence noisy Astro logs unless the operator explicitly opts in.
      ASTRO_LOG_LEVEL: process.env.E2E_ASTRO_LOG_LEVEL ?? "silent",
      // PR 4.5 (secrets-refactor): PTD legal-page SST Secret fixtures.
      // These are TEST values injected into `astro dev` so the
      // remark plugin + [slug].astro substitute() read non-empty
      // strings at runtime. Real production values come from SST
      // Secrets via `scripts/setup-secrets.sh` + `sst deploy`. Do NOT
      // replace these with the real operator-supplied values: the
      // tests must not depend on (or leak) production PII.
      PTD_RAZON_SOCIAL: "Opita Code (E2E test value)",
      PTD_NIT: "TEST-NIT-DO-NOT-USE-IN-PROD",
      PTD_DIRECCION: "Neiva, Huila, Colombia (E2E test value)",
      PTD_REP_LEGAL: "Representante Legal (E2E test value)",
      PTD_EMAIL_PUBLICO: "e2e-public@example.com",
      PTD_DPO_EMAIL: "e2e-dpo@example.com",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});