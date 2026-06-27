/**
 * legal-secrets.ts — Legal page substitutions (PTD + Aviso de Privacidad)
 *
 * Two-tier lookup strategy:
 *
 *  1. **Generated constants** from `scripts/build.js` (BUILD TIME)
 *     The build wrapper reads .env + wrangler.toml [vars] and writes the
 *     resolved values to `src/lib/legal-secrets.generated.ts` as TS
 *     constants. esbuild then INLINES these as literal values in the
 *     bundle. This makes the substitutions work in BOTH:
 *       - The Astro content-collection data layer (compiled at build time)
 *       - The Cloudflare Workers runtime (per-request rendering)
 *
 *  2. **Runtime fallback** via `import.meta.env` (PUBLIC_PTD_* vars) for
 *     dev hot-reload scenarios where the generated module is stale.
 *
 *  3. **Loud fallback**: missing values → "[Pendiente: configurar <Name>]"
 *     so config errors are loud, never silent.
 *
 * Token catalogue (substituted as {{TOKEN}} in markdown bodies):
 *   RAZON_SOCIAL, NIT, DIRECCION, REP_LEGAL, EMAIL_PUBLICO, DPO_EMAIL, TELEFONO
 *
 * Mirrors the SST Secrets that previously fed these values via
 * sst.config.ts (legalRazonSocial.value, legalNit.value, etc.).
 *
 * IMPORTANT: never log the resolved value. DPO_EMAIL is private.
 */

// Build-time generated constants (overwritten by scripts/build.js on each build)
// PR 3 — closes MW-FE-008: PTD_DPO_EMAIL is NO LONGER bundled.
// DPO contact is fetched at runtime via /api/legal/dpo-contact.
import {
  PTD_RAZON_SOCIAL as GEN_PTD_RAZON_SOCIAL,
  PTD_NIT as GEN_PTD_NIT,
  PTD_DIRECCION as GEN_PTD_DIRECCION,
  PTD_REP_LEGAL as GEN_PTD_REP_LEGAL,
  PTD_EMAIL_PUBLICO as GEN_PTD_EMAIL_PUBLICO,
  PTD_TELEFONO as GEN_PTD_TELEFONO,
  getDpoContactUrl,
} from "./legal-secrets.generated";

export const LEGAL_TOKENS = [
  "RAZON_SOCIAL",
  "NIT",
  "DIRECCION",
  "REP_LEGAL",
  "EMAIL_PUBLICO",
  "DPO_EMAIL",
  "TELEFONO",
] as const;

export type LegalToken = (typeof LEGAL_TOKENS)[number];
export type LegalSecrets = Record<LegalToken, string>;

/**
 * Resolve a secret. Order:
 *   1. Build-time generated constant (esbuild-inlined) — always wins
 *      unless empty
 *   2. import.meta.env.PUBLIC_<NAME> (Vite-inlined at build time, dev hot-reload)
 *   3. process.env.<NAME> (Node.js only — works in astro build context)
 *   4. "[Pendiente: configurar <Name>]"  ← loud fallback, never silent
 *
 * IMPORTANT: never echo the resolved value back to logs.
 */
function readSecret(
  generated: string | undefined,
  publicName: string,
  processName: string,
  secretName: string,
): string {
  // 1. Generated constant (preferred)
  if (typeof generated === "string" && generated.length > 0) return generated;
  // 2. import.meta.env (Vite-inlined PUBLIC_* in dev)
  try {
    const v = (import.meta as any).env?.[publicName];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // import.meta.env not available
  }
  // 3. process.env (Node.js only)
  const v = process.env[processName];
  if (typeof v === "string" && v.length > 0) return v;
  // 4. Loud fallback
  return `[Pendiente: configurar ${secretName}]`;
}

export function getLegalSecrets(): LegalSecrets {
  // PR 3 — DPO_EMAIL is now resolved at runtime via API, NOT bundled.
  // getDpoContactUrl() returns a same-origin URL that returns the
  // current DPO contact (form URL or alias — operator may rotate).
  return {
    RAZON_SOCIAL: readSecret(GEN_PTD_RAZON_SOCIAL, "PUBLIC_PTD_RAZON_SOCIAL", "PTD_RAZON_SOCIAL", "RazonSocial"),
    NIT: readSecret(GEN_PTD_NIT, "PUBLIC_PTD_NIT", "PTD_NIT", "Nit"),
    DIRECCION: readSecret(GEN_PTD_DIRECCION, "PUBLIC_PTD_DIRECCION", "PTD_DIRECCION", "Direccion"),
    REP_LEGAL: readSecret(GEN_PTD_REP_LEGAL, "PUBLIC_PTD_REP_LEGAL", "PTD_REP_LEGAL", "RepLegal"),
    EMAIL_PUBLICO: readSecret(GEN_PTD_EMAIL_PUBLICO, "PUBLIC_PTD_EMAIL_PUBLICO", "PTD_EMAIL_PUBLICO", "EmailPublico"),
    DPO_EMAIL: getDpoContactUrl(), // PR 3 — API-resolved, not bundled
    // PR 10 (closes OPL-COMP-001, HIGH): DPO / company phone (Ley 1581 Art. 13).
    // Operator MUST set a real number before go-live (placeholder is loud).
    TELEFONO: readSecret(GEN_PTD_TELEFONO, "PUBLIC_PTD_TELEFONO", "PTD_TELEFONO", "Telefono"),
  };
}

/**
 * Replace every `{{TOKEN}}` in `s` with the corresponding secret value
 * (or "Pendiente" marker if the secret is not set).
 */
export function substitute(s: string | undefined | null): string {
  if (!s) return s ?? "";
  const secrets = getLegalSecrets();
  let out = s;
  for (const tok of LEGAL_TOKENS) {
    out = out.split(`{{${tok}}}`).join(secrets[tok]);
  }
  return out;
}