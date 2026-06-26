import { defineMiddleware } from "astro:middleware";

/**
 * Global Astro middleware. Populates `Astro.locals.user` (and `requestId`) on
 * every request. The real JWT verification happens in `verifyJwt` from
 * `lib/cognito-sso-consumer` — we keep the middleware intentionally thin so
 * the auth surface stays testable and easy to mock.
 *
 * DPO dashboard gating is enforced inside this file at `/admin/dpo/*`.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  // Lazy import so the dev server doesn't crash if `jose` resolution fails on first boot.
  const { verifyJwt, requireGroup } = await import("./lib/cognito-sso-consumer");

  context.locals.requestId = crypto.randomUUID();

  const user = await verifyJwt(context).catch(() => null);
  context.locals.user = user;

  const path = context.url.pathname;
  if (path.startsWith("/admin/dpo")) {
    return requireGroup(context, "dpo");
  }

  return next();
});