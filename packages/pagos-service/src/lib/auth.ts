import type { Context, Next } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { UnauthenticatedError, ForbiddenNotDpoError } from "./errors.js";

/**
 * Cognito 3-tier auth (mirrors compliance-service pattern):
 *   1. Authorization: Bearer <jwt> → verify via JWKS from Cognito
 *   2. Cookie `opita_id_token` (Cognito)
 *   3. Cookie `opita_session` (legacy HMAC)
 *
 * For tests: `mockAuth` writes to context.user directly.
 *
 * For PR 6: the JWKS URL is read from env COGNITO_ISSUER.
 * In production, the issuer is `https://cognito-idp.us-east-1.amazonaws.com/<user-pool-id>`
 * and the JWKS endpoint is `<issuer>/.well-known/jwks.json`.
 */

const COGNITO_ISSUER = process.env.COGNITO_ISSUER ?? "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_LItAcj2Aa";
const JWKS_URL = `${COGNITO_ISSUER}/.well-known/jwks.json`;
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

export interface AuthUser {
  email: string;
  groups: string[];
  deviceId?: string;
  ip?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser | null;
  }
}

/**
 * Auth middleware — tries all 3 sources in order.
 * On success, sets context.user. On failure, sets context.user = null
 * (the route handler decides whether to throw UnauthenticatedError).
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  // 1. Bearer token
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const user = await verifyCognitoToken(token);
    if (user) {
      c.set("user", user);
      return next();
    }
  }

  // 2. opita_id_token cookie
  const cookieHeader = c.req.header("cookie") ?? c.req.header("Cookie") ?? "";
  const cognitoMatch = cookieHeader.match(/opita_id_token=([^;]+)/);
  if (cognitoMatch && cognitoMatch[1]) {
    const user = await verifyCognitoToken(cognitoMatch[1]);
    if (user) {
      c.set("user", user);
      return next();
    }
  }

  // 3. opita_session cookie (legacy HMAC)
  const sessionMatch = cookieHeader.match(/opita_session=([^;]+)/);
  if (sessionMatch && sessionMatch[1]) {
    const user = verifyLegacySession(sessionMatch[1]);
    if (user) {
      c.set("user", user);
      return next();
    }
  }

  // 4. x-dev-user header (mock auth for dev/testing — never in prod)
  const devUserHeader = c.req.header("x-dev-user");
  if (devUserHeader && process.env.NODE_ENV !== "production") {
    const groupsHeader = c.req.header("x-dev-groups") ?? "";
    c.set("user", {
      email: devUserHeader,
      groups: groupsHeader.split(",").filter(Boolean),
      deviceId: c.req.header("x-device-id") ?? undefined,
      ip: c.req.header("x-forwarded-for") ?? undefined,
    });
    return next();
  }

  // No auth — leave as null (route handlers must check)
  c.set("user", null);
  return next();
}

/** Map AuthUser → JWT payload shape for verification. */
async function verifyCognitoToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: COGNITO_ISSUER,
    });
    return {
      email: (payload.email as string) ?? (payload.sub as string),
      groups: ((payload["cognito:groups"] as string[]) ?? []),
    };
  } catch {
    return null;
  }
}

function verifyLegacySession(token: string): AuthUser | null {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) return null;
  try {
    const [h, b, sig] = token.split(".");
    if (!h || !b || !sig) return null;
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${h}.${b}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(b, "base64").toString("utf8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return { email: payload.email, groups: payload.groups ?? [] };
  } catch {
    return null;
  }
}

/** Throw UnauthenticatedError if no user in context. */
export function requireUser(c: Context): AuthUser {
  const user = c.get("user");
  if (!user) throw new UnauthenticatedError();
  return user;
}

/** Throw ForbiddenNotDpoError if user is not in 'dpo' group. */
export function requireDpo(c: Context): AuthUser {
  const user = requireUser(c);
  if (!user.groups.includes("dpo")) throw new ForbiddenNotDpoError();
  return user;
}