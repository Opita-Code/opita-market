/**
 * E2E for Ley 1581/2012 compliance surfaces — task 4.5 of
 * compliance-foundation PR 4.
 *
 * Covers:
 *   1. Footer of every public page carries a visible link to
 *      /legal/ptd and /legal/aviso.
 *   2. /legal/ptd loads and renders all 10 mandated sections.
 *   3. /legal/aviso loads and renders all 5 mandated sections.
 *   4. /admin/dpo returns 403 without a valid DPO JWT (negative auth).
 *   5. /admin/dpo returns 200 with a valid DPO dev JWT (positive auth).
 *
 * The dev JWT is signed with the same secret the dev server uses
 * (see e2e/fixtures/dev-jwt.ts + playwright.config.ts). Production uses
 * Cognito + jose — the same code path runs because we set JWT_SECRET.
 */

import { expect, test } from "@playwright/test";
import { devCookieHeader } from "./fixtures/dev-jwt.js";

const PTD_SECTIONS = [
  "Identificación",
  "Marco legal",
  "Definiciones",
  "Principios",
  "Finalidades",
  "Datos recolectados",
  "Derechos del titular",
  "Procedimiento",
  "Medidas de seguridad",
  "Vigencia",
];

const AVISO_SECTIONS = [
  "Identificación",
  "Finalidades",
  "Datos recolectados",
  "Política de Tratamiento de Datos",
  "Contacto del DPO",
];

test.describe("Legal pages (Ley 1581/2012) — task 4.5", () => {
  test("home page footer links to PTD and Aviso", async ({ page }) => {
    await page.goto("/");
    const ptdLink = page.locator('[data-testid="footer-link-ptd"]');
    const avisoLink = page.locator('[data-testid="footer-link-aviso"]');
    await expect(ptdLink).toBeVisible();
    await expect(avisoLink).toBeVisible();
    await expect(ptdLink).toHaveAttribute("href", "/legal/ptd");
    await expect(avisoLink).toHaveAttribute("href", "/legal/aviso");
  });

  test("/legal/ptd renders all 10 mandated sections", async ({ page }) => {
    await page.goto("/legal/ptd");
    await expect(page).toHaveTitle(/PTD|Tratamiento de Datos/i);
    // Wait for the markdown content to render before scanning section headers.
    await expect(page.locator("article")).toBeVisible();
    const articleText = (await page.locator("article").innerText()).toLowerCase();
    for (const section of PTD_SECTIONS) {
      expect(articleText, `PTD missing section header: ${section}`).toContain(
        section.toLowerCase(),
      );
    }
  });

  test("/legal/aviso renders all 5 mandated sections", async ({ page }) => {
    await page.goto("/legal/aviso");
    await expect(page).toHaveTitle(/Aviso de Privacidad/i);
    await expect(page.locator("article")).toBeVisible();
    const articleText = (await page.locator("article").innerText()).toLowerCase();
    for (const section of AVISO_SECTIONS) {
      expect(articleText, `Aviso missing section header: ${section}`).toContain(
        section.toLowerCase(),
      );
    }
  });

  test("/admin/dpo returns 401 without any JWT", async ({ request }) => {
    // No cookie set — middleware must short-circuit with 401 (AUTH_REQUIRED).
    const res = await request.get("/admin/dpo", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });

  test("/admin/dpo returns 403 with non-DPO JWT", async ({ request }) => {
    const cookieHeader = await devCookieHeader({
      email: "user@example.com",
      groups: ["tenant-owner"], // NOT 'dpo'
    });
    const res = await request.get("/admin/dpo", {
      headers: { cookie: cookieHeader },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
  });

  test("/admin/dpo returns 200 with DPO JWT", async ({ request }) => {
    const cookieHeader = await devCookieHeader({
      email: "dpo@opitamarket.com",
      groups: ["dpo"],
    });
    const res = await request.get("/admin/dpo", {
      headers: { cookie: cookieHeader },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    // The DPO dashboard heading should be present.
    expect(body).toContain("Panel del DPO");
  });
});