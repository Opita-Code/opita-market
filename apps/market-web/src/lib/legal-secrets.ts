/**
 * Legal secrets — SST Secret lookups for the PTD / Aviso de Privacidad pages.
 *
 * Per compliance-foundation PR 4.5: all personal data shown on the public
 * legal pages comes from SST Secrets injected at deploy time. Nothing
 * personal is hardcoded in `.md` / `.astro` / `.ts` git-tracked files.
 *
 * Six secrets are referenced (set up via `scripts/setup-secrets.sh`):
 *   RazonSocial   → PTD_RAZON_SOCIAL
 *   Nit           → PTD_NIT
 *   Direccion     → PTD_DIRECCION
 *   RepLegal      → PTD_REP_LEGAL
 *   EmailPublico  → PTD_EMAIL_PUBLICO
 *   DpoEmail      → PTD_DPO_EMAIL  (NEVER rendered publicly — DPO dashboard only)
 *
 * Tokens referenced inside markdown / frontmatter: {{RAZON_SOCIAL}},
 * {{NIT}}, {{DIRECCION}}, {{REP_LEGAL}}, {{EMAIL_PUBLICO}}, {{DPO_EMAIL}}.
 * The remark plugin (`remark-substitute-legal-placeholders.ts`) does the
 * body substitution at AST level so Astro's markdown pipeline still
 * processes the substituted text normally. The same helper handles
 * frontmatter / component-level substitution in `[slug].astro`.
 */

export const LEGAL_TOKENS = [
  "RAZON_SOCIAL",
  "NIT",
  "DIRECCION",
  "REP_LEGAL",
  "EMAIL_PUBLICO",
  "DPO_EMAIL",
] as const;

export type LegalToken = (typeof LEGAL_TOKENS)[number];

export type LegalSecrets = Record<LegalToken, string>;

/**
 * Read a secret from process.env. Falls back to a clearly-marked
 * "Pendiente" marker so missing configuration is loud, never silent.
 *
 * IMPORTANT: never echo the resolved value back to logs.
 */
function readSecret(envName: string, secretName: string): string {
  const v = process.env[envName];
  if (typeof v === "string" && v.length > 0) return v;
  return `[Pendiente: configurar ${secretName}]`;
}

export function getLegalSecrets(): LegalSecrets {
  return {
    RAZON_SOCIAL: readSecret("PTD_RAZON_SOCIAL", "RazonSocial"),
    NIT: readSecret("PTD_NIT", "Nit"),
    DIRECCION: readSecret("PTD_DIRECCION", "Direccion"),
    REP_LEGAL: readSecret("PTD_REP_LEGAL", "RepLegal"),
    EMAIL_PUBLICO: readSecret("PTD_EMAIL_PUBLICO", "EmailPublico"),
    DPO_EMAIL: readSecret("PTD_DPO_EMAIL", "DpoEmail"),
  };
}

/**
 * Replace every `{{TOKEN}}` in `s` with the corresponding SST Secret
 * value (or "Pendiente" marker if the secret is not set).
 *
 * Used by:
 *   - the remark plugin (body text substitution at AST level)
 *   - `[slug].astro` (frontmatter values like `summary` / `contact_email`)
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
