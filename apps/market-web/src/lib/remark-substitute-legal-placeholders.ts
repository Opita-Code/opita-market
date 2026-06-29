/**
 * Remark plugin: substitute `{{TOKEN}}` placeholders inside legal-page
 * markdown bodies.
 *
 * Runs at TWO points in Astro 5 SSR + @astrojs/cloudflare:
 *   1. BUILD TIME — when the content-collection data-layer pre-processes
 *      markdown into the _astro_data-layer-content chunk (visible at
 *      https://market-dev.opitacode.com). At this point, esbuild inlines
 *      the GEN_PTD_* imports as literal values (from legal-secrets.generated.ts,
 *      regenerated on each build by scripts/build.js). So this works
 *      correctly on Cloudflare Pages.
 *   2. RUNTIME — when [slug].astro calls `render(entry)`, which re-runs
 *      the remark pipeline. Same inlined values, same correct output.
 *
 * The 4-tier fallback in legal-secrets.ts handles edge cases where the
 * generated module isn't present (e.g. raw `astro dev` without our wrapper
 * script). In that case it falls back to import.meta.env → process.env →
 * [Pendiente] marker.
 *
 * Reads directly from the generated constants (no process.env) to maximize
 * reliability in both build-time and runtime contexts.
 */

import { visit } from "unist-util-visit";
import type { Root, Text } from "mdast";
import {
  PTD_RAZON_SOCIAL,
  PTD_NIT,
  PTD_DIRECCION,
  PTD_REP_LEGAL,
  PTD_EMAIL_PUBLICO,
  PTD_TELEFONO,
  getDpoContactUrl,
} from "./legal-secrets.generated";

const SECRETS: Record<string, string> = {
  RAZON_SOCIAL: PTD_RAZON_SOCIAL,
  NIT: PTD_NIT,
  DIRECCION: PTD_DIRECCION,
  REP_LEGAL: PTD_REP_LEGAL,
  EMAIL_PUBLICO: PTD_EMAIL_PUBLICO,
  // PR 10 (closes OPL-COMP-001, HIGH): company phone — Ley 1581 Art. 13
  // requires a real contact number on the PTD. Was missing from this dict
  // so the rendered page showed literal "{{TELEFONO}}" — fixed in v0.1.0-demo-4.
  TELEFONO: PTD_TELEFONO,
  // PR 3 — closes MW-FE-008: DPO_EMAIL no longer bundled.
  // Resolved at runtime via /api/legal/dpo-contact endpoint.
  DPO_EMAIL: getDpoContactUrl(),
};

export default function remarkSubstituteLegalPlaceholders() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text) => {
      if (typeof node.value !== "string" || !node.value.includes("{{")) return;
      let out = node.value;
      for (const [tok, val] of Object.entries(SECRETS)) {
        out = out.split(`{{${tok}}}`).join(val || `[Pendiente: configurar ${tok}]`);
      }
      node.value = out;
    });
  };
}
