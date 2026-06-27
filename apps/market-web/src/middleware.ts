import { defineMiddleware } from "astro:middleware";
import { buildSecurityHeaders } from "./lib/security-headers";

/**
 * Global Astro middleware. Populates `Astro.locals.user` (and `requestId`) on
 * every request. The real JWT verification happens in `verifyJwt` from
 * `lib/cognito-sso-consumer` — we keep the middleware intentionally thin so
 * the auth surface stays testable and easy to mock.
 *
 * DPO dashboard gating is enforced inside this file at `/admin/dpo/*`.
 *
 * PR 3: also applies security headers (closes MW-FE-004 CSP + frame-ancestors).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { verifyJwt, requireGroup } = await import("./lib/cognito-sso-consumer");

  context.locals.requestId = crypto.randomUUID();

  const user = await verifyJwt(context).catch(() => null);
  context.locals.user = user;

  const path = context.url.pathname;
  if (path.startsWith("/admin/dpo")) {
    const gate = await requireGroup(context, "dpo");
    // requireGroup returns a passthrough Response (status 200) when allowed.
    // Anything else (401 / 403) must short-circuit the pipeline.
    if (gate.status !== 200) {
      return gate;
    }
  }

  const response = await next();

  // Apply security headers (PR 3 — closes MW-FE-004, OPL-API-008).
  // dev = relaxed HSTS + Vite HMR allowed in CSP.
  const isProduction = import.meta.env.PROD === true;
  const headers = buildSecurityHeaders({
    isProduction,
    isDev: !isProduction,
  });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }

  return response;
});