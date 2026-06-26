// @ts-check
import { defineConfig } from "astro/config";
import aws from "astro-sst";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import remarkSubstituteLegalPlaceholders from "./src/lib/remark-substitute-legal-placeholders.ts";

/**
 * Astro 5 config for market-web (PTD + Aviso + DPO dashboard at
 * market.opitacode.com).
 *
 * PR 4.5: register a remark plugin that substitutes `{{TOKEN}}` markers
 * inside legal markdown bodies with values from SST Secrets. The same
 * helper is also used by `src/pages/legal/[slug].astro` for frontmatter
 * values (summary, contact_email). See `src/lib/legal-secrets.ts`.
 */
export default defineConfig({
  output: "server",
  adapter: aws({ responseMode: "stream" }),
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
