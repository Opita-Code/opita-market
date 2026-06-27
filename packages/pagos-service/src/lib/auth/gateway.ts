/**
 * Centralized auth gateway.
 *
 * Every protected endpoint MUST call authGateway(ctx) and use the returned
 * AuthContext for role checks.
 *
 * Flow:
 *   1. Try dev-bypass (only if DEV_AUTH_ENABLED=true and x-dev-user present)
 *   2. Try JWT (Bearer or __opita_session cookie)
 *   3. If no auth: rate-limit by IP, throw UnauthenticatedError
 *   4. If auth: rate-limit by userId+role, return AuthContext
 */

import type { Context } from "hono";
import {
  ExpiredTokenError,
  InvalidAudienceError,
  InvalidIssuerError,
  InvalidSignatureError,
  RateLimitError,
  UnauthenticatedError,
} from "./errors.js";
import { verifyJwt } from "./jwt.js";
import { RATE_LIMITS } from "./rate-limit.js";
import type { AuthContext, AuthGatewayDeps, AuthMethod, Role } from "./types.js";

function extractToken(ctx: Context): string | undefined {
  const auth = ctx.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookie = ctx.req.header("cookie");
  if (!cookie) return undefined;
  // Parse __opita_session=<token> from cookie header
  const match = cookie.match(/(?:^|;\s*)__opita_session=([^;]+)/);
  return match ? match[1] : undefined;
}

function getIp(ctx: Context): string {
  return ctx.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function tryDevBypass(ctx: Context): AuthContext | null {
  const devUser = ctx.req.header("x-dev-user");
  if (!devUser) return null;
  const groupsHeader = ctx.req.header("x-dev-groups") ?? "";
  const groups = groupsHeader
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean) as Role[];
  return {
    userId: devUser,
    email: devUser,
    groups,
    deviceId: ctx.req.header("x-device-id") ?? undefined,
    ip: getIp(ctx),
    authMethod: "dev-bypass",
  };
}

function primaryRole(ctx: AuthContext): keyof typeof RATE_LIMITS {
  if (ctx.groups.includes("admin")) return "admin";
  if (ctx.groups.includes("dpo")) return "dpo";
  if (ctx.groups.includes("merchant")) return "merchant";
  return "user";
}

export async function authGateway(
  ctx: Context,
  deps: AuthGatewayDeps,
): Promise<AuthContext> {
  const ip = getIp(ctx);

  // 1. Try dev-bypass (if explicitly enabled)
  if (deps.devBypassEnabled()) {
    const devCtx = tryDevBypass(ctx);
    if (devCtx) {
      const limit = RATE_LIMITS[primaryRole(devCtx)];
      const result = await deps.rateLimiter.check(
        `user:${devCtx.userId}`,
        limit.max,
        limit.windowMs,
      );
      if (!result.allowed) {
        throw new RateLimitError(undefined, result.retryAfterSeconds ?? 60);
      }
      return devCtx;
    }
    // Dev-bypass enabled but no x-dev-user header → fall through to JWT/anonymous
  }

  // 2. Try JWT
  const token = extractToken(ctx);
  if (token) {
    const verified = await verifyJwt(
      token,
      deps.jwtSecret,
      deps.jwtAudience,
      deps.jwtIssuer,
    );
    const authCtx: AuthContext = {
      userId: verified.sub,
      email: verified.email,
      groups: verified.groups,
      deviceId: ctx.req.header("x-device-id") ?? undefined,
      ip,
      authMethod: "jwt",
    };
    const limit = RATE_LIMITS[primaryRole(authCtx)];
    const result = await deps.rateLimiter.check(
      `user:${authCtx.userId}`,
      limit.max,
      limit.windowMs,
    );
    if (!result.allowed) {
      throw new RateLimitError(undefined, result.retryAfterSeconds ?? 60);
    }
    return authCtx;
  }

  // 3. No auth: rate-limit by IP, then throw
  const anonLimit = RATE_LIMITS.anonymous;
  const result = await deps.rateLimiter.check(
    `ip:${ip}`,
    anonLimit.max,
    anonLimit.windowMs,
  );
  if (!result.allowed) {
    throw new RateLimitError(undefined, result.retryAfterSeconds ?? 60);
  }
  throw new UnauthenticatedError();
}
