/**
 * Astro API endpoint: returns the current DPO contact URL.
 *
 * PR 3 — closes MW-FE-008 (DPO email was bundled in client JS).
 * The DPO email/contact URL is now served at runtime, never bundled.
 *
 * Operator action:
 *   1. Set PUBLIC_DPO_CONTACT_URL in wrangler.toml [vars] or .env
 *      (e.g., a contact form URL or alias like "https://forms.opitacode.com/dpo")
 *   2. The endpoint reads it and returns the JSON { url }
 *   3. Frontend substitutes {{DPO_EMAIL}} placeholders with this URL
 */

export const prerender = false;

export async function GET() {
  // Read from runtime env (Cloudflare Workers vars or .env)
  const url =
    (typeof process !== "undefined" && process.env?.PUBLIC_DPO_CONTACT_URL) ||
    // Fallback: relative URL to a contact form page on this site
    "/contacto-dpo";
  return new Response(JSON.stringify({ url }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, s-maxage=300", // 5min cache
    },
  });
}
