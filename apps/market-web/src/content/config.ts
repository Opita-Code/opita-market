import { defineCollection, z } from "astro:content";

/**
 * Content Collections for legal documents published on market.opitacode.com.
 *
 * Per colombia-habeas-data skill, every legal artifact requires:
 *   - title (human-readable)
 *   - slug (URL slug)
 *   - effective_date (ISO date — when this version takes effect)
 *   - version (semver-like, e.g. "1.0.0")
 *   - requires_dpo_approval: true (enforced — DPO must approve changes)
 *
 * Markdown source lives under src/content/legal/*.md and is rendered at
 * /legal/<slug> via src/pages/legal/[slug].astro.
 */
const legal = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().min(5).max(200),
    slug: z.string().regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
    effective_date: z.date(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver (X.Y.Z)"),
    requires_dpo_approval: z.literal(true),
    summary: z.string().min(20).max(500).optional(),
    contact_email: z.string().email().default("dpo@opitamarket.com.co"),
  }),
});

export const collections = { legal };