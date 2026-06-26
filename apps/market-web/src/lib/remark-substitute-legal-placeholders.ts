/**
 * Remark plugin: substitute `{{TOKEN}}` placeholders inside legal-page
 * markdown bodies with values from SST Secrets.
 *
 * Runs at AST level so the substituted text still flows through Astro's
 * normal markdown pipeline (components, headings, links, etc.).
 *
 * The same substitution helper is used by `[slug].astro` for frontmatter
 * values (`summary`, `contact_email`). See `legal-secrets.ts` for the
 * token catalogue and the secret lookup logic.
 */

import { visit } from "unist-util-visit";
import type { Root, Text } from "mdast";
import { substitute } from "./legal-secrets";

export default function remarkSubstituteLegalPlaceholders() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text) => {
      if (typeof node.value === "string" && node.value.includes("{{")) {
        node.value = substitute(node.value);
      }
    });
  };
}
