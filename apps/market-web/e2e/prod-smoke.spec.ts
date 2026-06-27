/**
 * Production smoke test (compliance-foundation PR 5 — task 5.5).
 *
 * Runs against the PRODUCTION URL (market.opitacode.com / api.opitacode.com),
 * NOT against `astro dev`. Operators invoke this AFTER `sst deploy --stage prod`
 * to verify the live deployment:
 *
 *   1. The Astro storefront responds with HTTP 200 on the home page.
 *   2. PTD renders with substituted SST Secret values (no `{{TOKEN}}` leakage).
 *   3. Aviso renders with substituted SST Secret values (no `{{TOKEN}}` leakage).
 *   4. The public PTD/Aviso body NEVER leaks the production DPO email
 *      (it is `process.env.PTD_DPO_EMAIL`, server-side only).
 *   5. /admin/dpo returns 403 without an auth cookie (the public path
 *      is the storefront, the dashboard is Cognito-gated).
 *   6. POSTing a suppression request with a clearly-fake NIT returns a
 *      4xx (not 500) — proves the rights handler does NOT panic on bad
 *      input and that Verifik isn't bypassed by a junk NIT.
 *
 * How to run:
 *
 *   # Override the base URL to prod + run ONLY this spec file.
 *   PLAYWRIGHT_BASE_URL=https://market.opitacode.com \
 *     npx playwright test e2e/prod-smoke.spec.ts
 *
 *   # Or against a custom URL (e.g. staging).
 *   PLAYWRIGHT_BASE_URL=https://market-staging.opitacode.com \
 *     npx playwright test e2e/prod-smoke.spec.ts
 *
 *   # When PLAYWRIGHT_BASE_URL is UNSET the suite skips — this keeps
 *   # the regular `npm run test:e2e` (which boots `astro dev`) green
 *   # even though this spec file is checked in.
 *
 * Why these assertions and not others?
 *
 *   - We deliberately avoid asserting on dynamic UI copy (prices, listing
 *     names) because the change immediately after this one is the
 *     marketplace-catalog-mvp; the storefront body shape WILL change.
 *     What we DO assert on is the Habeas Data surface that compliance
 *     governs: legal pages render, DPO email stays private, rights
 *     handler doesn't blow up on bad input.
 *
 *   - We use a synthetic NIT (000.000.000-0 / dv 0) on the suppression
 *     request so the test NEVER hits the real Verifik API with a
 *     real Colombian business. The expected status is 4xx (input
 *     rejected by Zod) or 503 (Verifik unreachable) — never 500
 *     (unhandled exception). The exact 4xx depends on the rights
 *     handler's validation order; both are acceptable per design.md
 *     §"Titular rights workflow".
 */

import { expect, test } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;

// Skip the entire suite if the operator hasn't opted in by setting the
// base URL. This is how `npm run test:e2e` (which runs ALL spec files
// in e2e/) stays green while the prod smoke tests are dark by default.
test.describe("Opita Market — Production Smoke Test", () => {
  test.skip(
    !BASE_URL,
    "PLAYWRIGHT_BASE_URL is not set — skipping prod smoke test. " +
      "Run with `PLAYWRIGHT_BASE_URL=https://market.opitacode.com npx playwright test e2e/prod-smoke.spec.ts`.",
  );

  test.use({ baseURL: BASE_URL });

  test("Home page returns HTTP 200", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status(), "home page should be reachable in prod").toBe(200);
  });

  test("PTD page renders with substituted values (no {{TOKEN}} leakage)", async ({ page }) => {
    await page.goto("/legal/ptd");
    await expect(page.locator("article")).toBeVisible();
    const body = await page.locator("body").innerText();

    // No unsubstituted placeholders. If a deploy missed wiring an SST
    // Secret, the page renders either {{TOKEN}} or the
    // "[Pendiente: configurar X]" marker. Both are caught here.
    expect(body, "PTD leaked a {{TOKEN}} marker").not.toContain("{{");
    expect(body, "PTD shows the fallback '[Pendiente: configurar ...]' marker").not.toContain(
      "[Pendiente: configurar",
    );

    // Substituted values from setup-secrets.sh (RazonSocial = "Opita Code",
    // EmailPublico = "Owner@opitacode.com"). If these are missing the
    // SST Secrets binding in sst.config.ts is broken.
    expect(body, "PTD did not substitute RazonSocial").toContain("Opita Code");
    expect(body, "PTD did not substitute EmailPublico").toContain("Owner@opitacode.com");

    // The DPO email is server-side only — it must NEVER render on the
    // public PTD page. If this assertion fails, the
    // remark-substitute-legal-placeholders plugin is leaking.
    expect(body, "DPO email leaked into public PTD body").not.toContain(
      "nicourrutia83@gmail.com",
    );
  });

  test("Aviso page renders with substituted values (no {{TOKEN}} leakage)", async ({ page }) => {
    await page.goto("/legal/aviso");
    await expect(page.locator("article")).toBeVisible();
    const body = await page.locator("body").innerText();

    expect(body, "Aviso leaked a {{TOKEN}} marker").not.toContain("{{");
    expect(body, "Aviso shows the fallback '[Pendiente: configurar ...]' marker").not.toContain(
      "[Pendiente: configurar",
    );
    expect(body, "Aviso did not substitute RazonSocial").toContain("Opita Code");
    expect(body, "DPO email leaked into public Aviso body").not.toContain(
      "nicourrutia83@gmail.com",
    );
  });

  test("/admin/dpo returns 403 without auth", async ({ request }) => {
    // The dashboard is Cognito-gated. Without a session cookie the
    // middleware must short-circuit with 401 (no token) or 403 (token
    // present but not in 'dpo' group). Both are acceptable — the test
    // only guards against 200 (auth bypass) and 500 (server crash).
    const response = await request.get("/admin/dpo", { maxRedirects: 0 });
    expect([401, 403]).toContain(response.status());
  });

  test("Rights API: suppression request with synthetic NIT returns 4xx (never 500)", async ({
    request,
  }) => {
    // 000.000.000-0 / dv 0 is a synthetic NIT that the Verifik API would
    // reject. We do NOT want this test to ever resolve a real Colombian
    // business. The handler should:
    //   - 400 (Zod rejects the format), OR
    //   - 401 / 403 (auth gate — suppression may require DPO auth), OR
    //   - 503 (Verifik API unreachable / down — design.md §"Verifik fallback").
    // What it MUST NOT return is 500 (unhandled exception = real bug).
    const response = await request.post("/market/rights/suppress", {
      data: {
        nit: "000000000",
        dv: "0",
        request_type: "suppress",
        payload: { reason: "prod smoke test — synthetic NIT, ignore" },
      },
      failOnStatusCode: false,
    });
    expect([400, 401, 403, 503]).toContain(response.status());
    expect(response.status(), "rights handler 500'd on synthetic NIT").not.toBe(500);
  });
});