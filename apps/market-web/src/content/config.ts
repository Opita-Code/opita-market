import { defineCollection, z } from "astro:content";

/**
 * Content Collections for legal documents published on market.opitacode.com.
 *
 * Per colombia-habeas-data skill, every legal artifact requires:
 *   - title (human-readable)
 *   - effective_date (ISO date — when this version takes effect)
 *   - version (semver-like, e.g. "1.0.0")
 *   - requires_dpo_approval: true (enforced — DPO must approve changes)
 *
 * PR 4.5: `contact_email` and `summary` may contain `{{TOKEN}}` markers
 * that get substituted at render time by `src/lib/legal-secrets.ts`.
 * The schema accepts either a valid email or a `{{PLACEHOLDER}}` token
 * so build-time validation passes for unconfigured environments.
 *
 * Markdown source lives under src/content/legal/*.md and is rendered at
 * /legal/<slug> via src/pages/legal/[slug].astro.
 */

const PLACEHOLDER_PATTERN = /^\{\{[A-Z_]+\}\}$/;

const legal = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().min(5).max(200),
    effective_date: z.date(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver (X.Y.Z)"),
    requires_dpo_approval: z.literal(true),
    summary: z.string().min(20).max(500).optional(),
    contact_email: z
      .string()
      .refine(
        (s) => PLACEHOLDER_PATTERN.test(s) || z.string().email().safeParse(s).success,
        { message: "must be a valid email or a {{TOKEN}} placeholder" },
      )
      .default("{{EMAIL_PUBLICO}}"),
  }),
});

export const collections = { legal };
