// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import remarkSubstituteLegalPlaceholders from "./src/lib/remark-substitute-legal-placeholders.ts";

/**
 * Astro 5 config for market-web (PTD + Aviso + DPO dashboard at
 * market.opitacode.com).
 *
 * PR cf-hybrid (2026-06-26): migrated from astro-sst → @astrojs/cloudflare.
 *   Astro frontend now deploys to Cloudflare Pages (edge SSR, ~30s deploys)
 *   Compliance backend (Hono Lambda + Aurora + Object Lock S3) stays on AWS
 *   via SST — see sst.config.ts. Why hybrid:
 *   - SST v4 is in maintenance mode (team shifted to OpenCode); bug fixes
 *     for the CloudFormation churn we hit (Aurora vpc, lifecycle format,
 *     Cron syntax, Lambda.metric() API) are unlikely.
 *   - Cloudflare acquired Astro Jan 2026; @astrojs/cloudflare is the
 *     blessed path going forward.
 *   - Cloudflare Pages deploy is local-CPU-friendly (zip + upload, ~30s).
 *   - Compliance data (PII, audit log, WORM receipts) stays on AWS Aurora
 *     with Object Lock COMPLIANCE mode + 7y retention documented in RUNBOOK.
 *
 * PR 4.5: register a remark plugin that substitutes `{{TOKEN}}` markers
 * inside legal markdown bodies with values from Cloudflare Pages env vars
 * (formerly SST Secrets). The same helper is also used by
 * `src/pages/legal/[slug].astro` for frontmatter values (summary,
 * contact_email). See `src/lib/legal-secrets.ts`.
 */
export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: "compile",
  }),
  integrations: [react()],
  markdown: {
    remarkPlugins: [remarkSubstituteLegalPlaceholders],
  },
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    port: 4321,
  },
  site: "https://market.opitacode.com",
  i18n: {
    defaultLocale: "es",
    locales: ["es"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
