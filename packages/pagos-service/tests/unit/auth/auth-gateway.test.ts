/**
 * Tests for the auth gateway.
 *
 * SECURITY-CRITICAL — closes:
 *   OPL-LIB-005 — x-dev-user fail-open when NODE_ENV undefined (Lambda default)
 *   MW-FE-003  — same pattern in cognito-sso-consumer (frontend)
 *   MW-FE-006  — JWT aud not validated
 *   OPL-API-006 — no rate limiting (partial)
 *
 * TDD: these are RED until src/lib/auth/* modules are implemented.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SignJWT } from "jose";
import { authGateway, type AuthGatewayDeps, type AuthContext } from "../../../src/lib/auth/gateway.js";
import { InMemoryRateLimiter } from "../../../src/lib/auth/rate-limit.js";
import { requireRole } from "../../../src/lib/auth/rbac.js";
import { isDevBypassEnabled, DEV_AUTH_FLAG } from "../../../src/lib/auth/dev-bypass.js";
import {
  UnauthenticatedError,
  InvalidAudienceError,
  InvalidIssuerError,
  ExpiredTokenError,
  ForbiddenError,
  RateLimitError,
} from "../../../src/lib/auth/errors.js";
import type { Context } from "hono";

const SECRET = "test-jwt-secret-must-be-long-enough-for-hs256-32bytes";
const AUD = "market.opitacode.com";
const ISS = "cuenta.opitacode.com";

const encoder = new TextEncoder();

async function signJwt(
  payload: Record<string, unknown>,
  expiresIn: string | number = "1h",
  overrides: { aud?: string; iss?: string } = {},
): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setAudience(overrides.aud ?? AUD)
    .setIssuer(overrides.iss ?? ISS)
    .setSubject((payload.sub as string) ?? "user-123")
    .sign(encoder.encode(SECRET));
}

function mockContext(headers: Record<string, string | undefined> = {}): Context {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) lower[k.toLowerCase()] = v;
  }
  return {
    req: {
      header: (name: string) => lower[name.toLowerCase()],
    },
  } as unknown as Context;
}

function makeDeps(overrides: Partial<AuthGatewayDeps> = {}): AuthGatewayDeps {
  return {
    jwtSecret: SECRET,
    jwtAudience: AUD,
    jwtIssuer: ISS,
    rateLimiter: new InMemoryRateLimiter(),
    devBypassEnabled: () => false,
    ...overrides,
  };
}

describe("auth-gateway — R1: Mandatory JWT verification", () => {
  it("returns AuthContext with valid Bearer JWT", async () => {
    const token = await signJwt({ sub: "user-1", email: "a@b.com", "cognito:groups": ["user"] });
    const ctx = mockContext({ authorization: `Bearer ${token}` });
    const result = await authGateway(ctx, makeDeps());
    expect(result.userId).toBe("user-1");
    expect(result.email).toBe("a@b.com");
    expect(result.groups).toEqual(["user"]);
    expect(result.authMethod).toBe("jwt");
  });

  it("returns AuthContext with valid __opita_session cookie", async () => {
    const token = await signJwt({ sub: "user-2", email: "c@d.com", "cognito:groups": ["user"] });
    const ctx = mockContext({ cookie: `__opita_session=${token}` });
    const result = await authGateway(ctx, makeDeps());
    expect(result.userId).toBe("user-2");
    expect(result.authMethod).toBe("jwt");
  });

  it("throws UnauthenticatedError when no auth provided", async () => {
    const ctx = mockContext();
    await expect(authGateway(ctx, makeDeps())).rejects.toThrow(UnauthenticatedError);
  });

  it("throws InvalidAudienceError when aud mismatches (closes MW-FE-006)", async () => {
    const token = await signJwt({ sub: "user-3", email: "e@f.com" }, "1h", { aud: "evil.com" });
    const ctx = mockContext({ authorization: `Bearer ${token}` });
    await expect(authGateway(ctx, makeDeps())).rejects.toThrow(InvalidAudienceError);
  });

  it("throws InvalidIssuerError when iss mismatches", async () => {
    const token = await signJwt({ sub: "user-4", email: "g@h.com" }, "1h", { iss: "evil.com" });
    const ctx = mockContext({ authorization: `Bearer ${token}` });
    await expect(authGateway(ctx, makeDeps())).rejects.toThrow(InvalidIssuerError);
  });

  it("throws ExpiredTokenError when token is expired", async () => {
    const token = await signJwt({ sub: "user-5", email: "i@j.com" }, "-1h");
    const ctx = mockContext({ authorization: `Bearer ${token}` });
    await expect(authGateway(ctx, makeDeps())).rejects.toThrow(ExpiredTokenError);
  });
});

describe("auth-gateway — R3: Dev-bypass via explicit flag (closes OPL-LIB-005, MW-FE-003)", () => {
  afterEach(() => {
    delete process.env[DEV_AUTH_FLAG];
  });

  it("activates dev-bypass when x-dev-user + DEV_AUTH_ENABLED=true", async () => {
    process.env[DEV_AUTH_FLAG] = "true";
    const ctx = mockContext({
      "x-dev-user": "dpo@opita.co",
      "x-dev-groups": "dpo,admin",
      "x-device-id": "dev-device",
      "x-forwarded-for": "127.0.0.1",
    });
    const result = await authGateway(ctx, makeDeps({ devBypassEnabled: isDevBypassEnabled }));
    expect(result.userId).toBe("dpo@opita.co");
    expect(result.groups).toEqual(["dpo", "admin"]);
    expect(result.authMethod).toBe("dev-bypass");
  });

  it("throws UnauthenticatedError when x-dev-user + DEV_AUTH_ENABLED unset (production default)", async () => {
    delete process.env[DEV_AUTH_FLAG];
    const ctx = mockContext({ "x-dev-user": "attacker@evil.com", "x-dev-groups": "dpo,admin" });
    await expect(
      authGateway(ctx, makeDeps({ devBypassEnabled: isDevBypassEnabled })),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("throws UnauthenticatedError when x-dev-user + NODE_ENV=undefined + DEV_AUTH_ENABLED unset (Lambda default — closes OPL-LIB-005)", async () => {
    delete process.env[DEV_AUTH_FLAG];
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const ctx = mockContext({ "x-dev-user": "attacker@evil.com" });
      await expect(
        authGateway(ctx, makeDeps({ devBypassEnabled: isDevBypassEnabled })),
      ).rejects.toThrow(UnauthenticatedError);
    } finally {
      if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe("auth-gateway — R2: RBAC", () => {
  it("requireRole passes when user has required role", () => {
    const ctx: AuthContext = {
      userId: "u",
      email: "e",
      groups: ["user", "dpo"],
      deviceId: undefined,
      ip: "x",
      authMethod: "jwt",
    };
    expect(() => requireRole(ctx, "dpo")).not.toThrow();
  });

  it("requireRole throws ForbiddenError when user lacks required role", () => {
    const ctx: AuthContext = {
      userId: "u",
      email: "e",
      groups: ["user"],
      deviceId: undefined,
      ip: "x",
      authMethod: "jwt",
    };
    expect(() => requireRole(ctx, "dpo")).toThrow(ForbiddenError);
  });

  it("requireRole accepts multiple roles (user must have any)", () => {
    const ctx: AuthContext = {
      userId: "u",
      email: "e",
      groups: ["merchant"],
      deviceId: undefined,
      ip: "x",
      authMethod: "jwt",
    };
    expect(() => requireRole(ctx, ["dpo", "merchant"])).not.toThrow();
  });
});

describe("auth-gateway — R5: Per-role rate limit (closes OPL-API-006 partial)", () => {
  it("throws RateLimitError when user exceeds 60 requests/minute", async () => {
    const token = await signJwt({ sub: "user-rl", email: "rl@b.com", "cognito:groups": ["user"] });
    const deps = makeDeps();
    // Make 60 successful calls
    for (let i = 0; i < 60; i++) {
      const ctx = mockContext({ authorization: `Bearer ${token}` });
      await authGateway(ctx, deps);
    }
    // 61st should throw RateLimitError
    const ctx = mockContext({ authorization: `Bearer ${token}` });
    await expect(authGateway(ctx, deps)).rejects.toThrow(RateLimitError);
  });

  it("throws RateLimitError on 21st anonymous request from same IP", async () => {
    const deps = makeDeps();
    // First 20 unauthenticated requests throw UnauthenticatedError
    for (let i = 0; i < 20; i++) {
      const ctx = mockContext({ "x-forwarded-for": "1.2.3.4" });
      await expect(authGateway(ctx, deps)).rejects.toThrow(UnauthenticatedError);
    }
    // 21st should be RateLimitError (rate-limited before auth throws)
    const ctx = mockContext({ "x-forwarded-for": "1.2.3.4" });
    await expect(authGateway(ctx, deps)).rejects.toThrow(RateLimitError);
  });

  it("rate limit is per-IP for anonymous, per-userId for authenticated", async () => {
    const deps = makeDeps();
    // User 1 makes 30 requests
    const token1 = await signJwt({ sub: "u1", email: "1@x.com", "cognito:groups": ["user"] });
    for (let i = 0; i < 30; i++) {
      const ctx = mockContext({ authorization: `Bearer ${token1}` });
      await authGateway(ctx, deps);
    }
    // User 2 from same context should not be rate limited yet
    const token2 = await signJwt({ sub: "u2", email: "2@x.com", "cognito:groups": ["user"] });
    const ctx = mockContext({ authorization: `Bearer ${token2}` });
    const result = await authGateway(ctx, deps);
    expect(result.userId).toBe("u2");
  });
});
