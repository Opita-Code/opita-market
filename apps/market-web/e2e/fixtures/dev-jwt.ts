/**
 * Dev JWT fixture for Playwright E2E.
 *
 * Mirrors the production shape used by `cognito-sso-consumer` (HS256,
 * jose) so the same Astro middleware code path runs in tests as in prod.
 *
 * The dev override in `cognito-sso-consumer.ts` only activates when
 * `NODE_ENV !== "production"` AND `JWT_SECRET` is unset. To exercise
 * the real JWT path with arbitrary roles (positive AND negative auth),
 * this fixture signs a token with a known dev secret and the test
 * server starts with `JWT_SECRET=<dev secret>` so the production code
 * path runs end-to-end.
 */

import { SignJWT } from "jose";

/** Fixed dev secret used by playwright.config.ts via `process.env.JWT_SECRET`. */
export const DEV_JWT_SECRET = "playwright-dev-secret-not-for-production-do-not-use";

export interface DevUserClaims {
  email: string;
  groups: ReadonlyArray<string>;
  /** Optional tenant scope. */
  tenantId?: string;
}

/** Sign a dev JWT cookie for the supplied user. */
export async function signDevJwt(claims: DevUserClaims, opts: { ttlSeconds?: number } = {}): Promise<string> {
  const ttl = opts.ttlSeconds ?? 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: `dev:${claims.email}`,
    email: claims.email,
    "cognito:groups": [...claims.groups],
    ...(claims.tenantId ? { "custom:tenant_id": claims.tenantId } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setIssuer("opita-market-dev")
    .setAudience("opita-market-dev")
    .sign(new TextEncoder().encode(DEV_JWT_SECRET));
  return token;
}

/**
 * Convenience: returns the cookie name used by `cognito-sso-consumer`.
 * Centralised so tests don't drift from prod.
 */
export const DEV_COOKIE_NAME = "__opita_session";

/** Build a `Cookie:` header value containing the dev JWT for a user. */
export async function devCookieHeader(claims: DevUserClaims): Promise<string> {
  const token = await signDevJwt(claims);
  return `${DEV_COOKIE_NAME}=${token}`;
}