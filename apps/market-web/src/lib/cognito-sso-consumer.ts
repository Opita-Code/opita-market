/**
 * Cognito SSO consumer for opita-market/market-web.
 *
 * Per `cognito-sso-consumer` skill — consumes the JWT cookie issued by
 * `cuenta.opitacode.com` (opita-account-ui, Cognito us-east-1_LItAcj2Aa)
 * using the shared `JWT_SECRET` SST Secret. NO direct Cognito SDK calls.
 *
 * Cookie: `__opita_session` (HttpOnly, Secure, SameSite=Lax, Domain=.opitacode.com)
 * Claims used:
 *   - sub           → userId
 *   - email         → email
 *   - cognito:groups → groups (e.g., "dpo", "admin", "tenant-owner")
 *   - custom:tenant_id → tenantId (multi-tenant scoping)
 *
 * Local-dev escape hatch: when NODE_ENV=development, set `x-dev-user: admin`
 * header (or `x-dev-groups: dpo,admin`) to bypass real JWT validation. This is
 * for local UI work only — production requires a real signed JWT.
 *
 * Environment resolution: market-web is deployed on Cloudflare Pages via
 * @astrojs/cloudflare. In that runtime, `process.env` is NOT available —
 * only `globalThis.env` (injected by the platform) is. In Vite/Node dev,
 * `process.env` works (Vite injects it at build time). We resolve at call
 * time, preferring `globalThis.env` to be Cloudflare-compatible, and fall
 * back to `process.env` for local Node tests. Closes MW-FE-012.
 */
import { jwtVerify, errors as joseErrors, type JWTPayload } from "jose";
import type { AstroGlobal, APIContext } from "astro";

export interface CognitoUser {
  userId: string;
  email: string;
  groups: ReadonlyArray<string>;
  tenantId?: string;
  raw: JWTPayload;
}

export class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const COOKIE_NAME = "__opita_session";
const DEV_HEADER_USER = "x-dev-user";
const DEV_HEADER_GROUPS = "x-dev-groups";
const DEV_HEADER_EMAIL = "x-dev-email";

/**
 * Resolve env vars at runtime. Cloudflare Pages / Workers runtime exposes
 * `globalThis.env` (injected by the platform). Vite/Node dev exposes
 * `process.env`. We check `globalThis.env` first because the production
 * runtime only has that surface, then fall back to `process.env` so local
 * dev still works.
 */
function getEnv(): Record<string, string | undefined> {
  const cfEnv = (globalThis as { env?: Record<string, string | undefined> })
    .env;
  if (cfEnv) return cfEnv;
  const proc = (globalThis as { process?: { env?: Record<string, string> } })
    .process;
  if (proc?.env) {
    return proc.env as Record<string, string | undefined>;
  }
  return {};
}

/**
 * Resolve the shared HMAC secret used to verify the JWT signature.
 * In production this is injected by Cloudflare Pages / Workers as
 * `globalThis.env.JWT_SECRET`. In local dev, it can be set in `.env`
 * (gitignored) which Vite exposes as `process.env.JWT_SECRET`.
 */
function getSecret(): Uint8Array {
  const raw = getEnv().JWT_SECRET ?? "";
  if (!raw) {
    throw new AuthError(
      "JWT_SECRET_MISSING",
      "JWT_SECRET environment variable is not set",
    );
  }
  return new TextEncoder().encode(raw);
}

/**
 * Pull the `__opita_session` cookie value out of any request context.
 * Accepts Astro APIContext (which has `cookies`) or a raw Headers + Cookie pair.
 */
function readCookie(context: APIContext | AstroGlobal): string | null {
  const cookie = context.cookies.get(COOKIE_NAME);
  if (cookie?.value) return cookie.value;

  // Fallback: parse Cookie header manually (e.g. Hono endpoints).
  const header = context.request?.headers.get("cookie");
  if (!header) return null;
  for (const piece of header.split(";")) {
    const [name, ...rest] = piece.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

/**
 * Apply the local-dev escape hatch. Only active when JWT_SECRET is unset AND
 * NODE_ENV !== "production". Mirrors the production shape so downstream code
 * doesn't need to special-case dev.
 */
function maybeDevOverride(
  context: APIContext | AstroGlobal,
): CognitoUser | null {
  const env = getEnv();
  if (env.NODE_ENV === "production") return null;
  if (env.JWT_SECRET) return null; // real secret present — never use dev override
  const headers = context.request?.headers;
  if (!headers) return null;
  const user = headers.get(DEV_HEADER_USER);
  if (!user) return null;
  const groups = (headers.get(DEV_HEADER_GROUPS) ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const email = headers.get(DEV_HEADER_EMAIL) ?? `${user}@dev.local`;
  return {
    userId: `dev:${user}`,
    email,
    groups,
    tenantId: undefined,
    raw: { sub: `dev:${user}`, email, ["cognito:groups"]: groups },
  };
}

/**
 * Verify the JWT cookie and return the decoded user payload, or `null`
 * if the cookie is missing / invalid. NEVER throws — downstream code decides
 * whether to require auth via `requireGroup` / `requireTenant`.
 */
export async function verifyJwt(
  context: APIContext | AstroGlobal,
): Promise<CognitoUser | null> {
  const dev = maybeDevOverride(context);
  if (dev) return dev;

  const token = readCookie(context);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });

    const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
    const tenantId = payload["custom:tenant_id"] as string | undefined;

    return {
      userId: (payload.sub as string) ?? "",
      email: (payload.email as string) ?? "",
      groups: Object.freeze(groups),
      tenantId,
      raw: payload,
    };
  } catch (e) {
    if (
      e instanceof joseErrors.JWTExpired ||
      e instanceof joseErrors.JWTInvalid ||
      e instanceof joseErrors.JWSSignatureVerificationFailed
    ) {
      return null;
    }
    return null;
  }
}

/**
 * Guard a route behind a required Cognito group. Returns 403 Response when
 * missing. Use inside Astro middleware or at the top of `.astro` pages.
 */
export function requireGroup(
  context: APIContext | AstroGlobal,
  group: string,
): Response | Promise<Response> {
  const user = context.locals?.user ?? null;
  if (!user) {
    return new Response(
      JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!user.groups.includes(group)) {
    return new Response(
      JSON.stringify({
        error: `Requires '${group}' group membership`,
        code: "FORBIDDEN",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  // Authenticated and authorized — return a passthrough Response with status 200.
  // Caller should ignore this and continue serving the page.
  return new Response(null, { status: 200 });
}

/**
 * Guard a route behind a specific tenant. Used when a tenant admin must
 * only see their own data. Returns 403 on mismatch.
 */
export function requireTenant(
  context: APIContext | AstroGlobal,
  tenantId: string,
): Response {
  const user = context.locals?.user ?? null;
  if (!user) {
    return new Response(
      JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  if (user.tenantId !== tenantId) {
    return new Response(
      JSON.stringify({
        error: "Cross-tenant access denied",
        code: "FORBIDDEN_CROSS_TENANT",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(null, { status: 200 });
}

/**
 * URL builder for `cuenta.opitacode.com` login/logout flows. Centralized so
 * we don't sprinkle absolute URLs across components.
 */
export function authUrls(currentPath: string) {
  const base = "https://cuenta.opitacode.com";
  return {
    login: `${base}/login?return=${encodeURIComponent(currentPath)}`,
    logout: `${base}/logout?return=${encodeURIComponent(currentPath)}`,
    refresh: `${base}/refresh?return=${encodeURIComponent(currentPath)}`,
  };
}