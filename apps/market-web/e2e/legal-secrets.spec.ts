/**
 * E2E for SST-Secret-driven placeholder substitution on PTD + Aviso
 * (compliance-foundation PR 4.5).
 *
 * Covers:
 *   1. No `{{TOKEN}}` markers leak into the rendered HTML for either page.
 *   2. The substituted values come from `process.env` — if a secret is
 *      misconfigured, the page renders the `[Pendiente: configurar X]`
 *      marker instead of silently rendering a literal `{{TOKEN}}`.
 *   3. The DPO email (PTD_DPO_EMAIL) is NEVER rendered on a public page
 *      even though the env var is set server-side — the public channel
 *      is PTD_EMAIL_PUBLICO.
 *
 * Test env vars come from `playwright.config.ts` and are deliberately
 * marked `(E2E test value)` so this suite never depends on (or asserts
 * against) production personal data. If a test starts failing because
 * someone changed a value in playwright.config.ts, that's the intended
 * blast radius — fix the test fixture, not the assertions.
 */

import { expect, test } from "@playwright/test";

const PLACEHOLDERS = [
  "{{RAZON_SOCIAL}}",
  "{{NIT}}",
  "{{DIRECCION}}",
  "{{REP_LEGAL}}",
  "{{EMAIL_PUBLICO}}",
  "{{DPO_EMAIL}}",
];

test.describe("Legal pages — SST Secret substitution (PR 4.5)", () => {
  test("PTD renders with no {{TOKEN}} leakage", async ({ page }) => {
    await page.goto("/legal/ptd");
    await expect(page.locator("article")).toBeVisible();
    const body = await page.locator("body").innerText();
    for (const tok of PLACEHOLDERS) {
      expect(body, `PTD leaked placeholder: ${tok}`).not.toContain(tok);
    }
  });

  test("Aviso renders with no {{TOKEN}} leakage", async ({ page }) => {
    await page.goto("/legal/aviso");
    await expect(page.locator("article")).toBeVisible();
    const body = await page.locator("body").innerText();
    for (const tok of PLACEHOLDERS) {
      expect(body, `Aviso leaked placeholder: ${tok}`).not.toContain(tok);
    }
  });

  test("PTD substitutes the EMAIL_PUBLICO env value into the page", async ({ page }) => {
    await page.goto("/legal/ptd");
    const body = await page.locator("body").innerText();
    // The test fixture in playwright.config.ts sets PTD_EMAIL_PUBLICO
    // to "e2e-public@example.com". If substitution is broken, the page
    // would either render {{EMAIL_PUBLICO}} (caught above) or the
    // [Pendiente: configurar ...] marker.
    expect(body).toContain("e2e-public@example.com");
    expect(body).not.toContain("[Pendiente: configurar");
  });

  test("PTD substitutes the RAZON_SOCIAL env value into the page", async ({ page }) => {
    await page.goto("/legal/ptd");
    const body = await page.locator("body").innerText();
    expect(body).toContain("Opita Code (E2E test value)");
  });

  test("DPO email (PTD_DPO_EMAIL) is NEVER rendered on public PTD body", async ({ page }) => {
    await page.goto("/legal/ptd");
    const body = await page.locator("body").innerText();
    // The DPO email exists server-side (in process.env) but should NEVER
    // appear in the public page HTML. The test fixture value is
    // "e2e-dpo@example.com" — if it leaks, substitution is treating the
    // DPO marker as if it were a public one.
    expect(body, "DPO email leaked into public PTD body").not.toContain("e2e-dpo@example.com");
  });

  test("DPO email (PTD_DPO_EMAIL) is NEVER rendered on public Aviso body", async ({ page }) => {
    await page.goto("/legal/aviso");
    const body = await page.locator("body").innerText();
    expect(body, "DPO email leaked into public Aviso body").not.toContain("e2e-dpo@example.com");
  });

  test("PTD does not leak the production DPO email literal either", async ({ page }) => {
    // Defense-in-depth: even though the test fixture uses a different
    // value, the production DPO email must never be hardcoded in any
    // git-tracked file. This test guards against a future regression
    // where someone copies the production email into a `.md` / `.astro`
    // / `.ts` file.
    await page.goto("/legal/ptd");
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("nicourrutia83@gmail.com");
  });

  test("Aviso uses the EMAIL_PUBLICO value in the contact section", async ({ page }) => {
    await page.goto("/legal/aviso");
    const body = await page.locator("body").innerText();
    // The mailto: link target + visible email text both come from the
    // substituted frontmatter value.
    expect(body).toContain("e2e-public@example.com");
    // The mailto: attribute is in the rendered DOM, not innerText — use
    // locator to verify the actual <a> element.
    const mailto = page.locator('a[href^="mailto:"]');
    await expect(mailto.first()).toHaveAttribute(
      "href",
      /mailto:e2e-public@example\.com/,
    );
  });
});
