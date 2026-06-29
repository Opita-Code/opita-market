/**
 * MW-FE-012: JWT secret resolution must use `globalThis.env` (Cloudflare
 * Pages runtime) at the time the verification runs, not `process.env`
 * captured at module-import time.
 *
 * Background: market-web is deployed on Cloudflare Pages via
 * @astrojs/cloudflare. In that runtime, `process.env` is NOT available —
 * only `globalThis.env` (injected by the platform) is. The dev escape
 * hatch + prod HMAC verification must both read env vars at call time.
 *
 * RED state: only `process.env.JWT_SECRET` is used → fails when the secret
 * is set via `globalThis.env` (which is what the Cloudflare runtime does
 * and what the @astrojs/cloudflare platformProxy does in dev).
 *
 * This test file uses the `node` environment (not jsdom) because jose's
 * `node:crypto` runtime is incompatible with jsdom's TextEncoder/Uint8Array
 * realm boundary. The auth code has no DOM dependencies.
 */
/// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

describe("MW-FE-012: env resolution at runtime (globalThis.env)", () => {
  const ORIGINAL_PROCESS = (globalThis as { process?: unknown }).process;
  const ORIGINAL_GLOBAL_ENV = (globalThis as { env?: unknown }).env;

  beforeEach(() => {
    // Strip both surfaces and re-import the module so module-level
    // destructuring (if any) is forced to re-run.
    delete (globalThis as { process?: unknown }).process;
    delete (globalThis as { env?: unknown }).env;
    vi.resetModules();
  });

  it("uses globalThis.env.JWT_SECRET at runtime (Cloudflare Pages path)", async () => {
    const secret = "global-env-secret-32-bytes-min-yes-here-";
    (globalThis as unknown as { env: Record<string, string> }).env = {
      JWT_SECRET: secret,
      NODE_ENV: "production",
    };

    // Re-import AFTER setting globalThis.env to defeat any
    // module-level capture.
    const { verifyJwt } = await import("../lib/cognito-sso-consumer.js");

    const token = await new SignJWT({ sub: "user-1", email: "u@x.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));

    const ctx = {
      cookies: { get: () => ({ value: token }) },
      request: { headers: new Headers({ cookie: `__opita_session=${token}` }) },
    };
    const user = await verifyJwt(ctx as never);
    expect(user).not.toBeNull();
    expect(user?.userId).toBe("user-1");
  });

  it("does not throw JWT_SECRET_MISSING when only globalThis.env has it", async () => {
    (globalThis as unknown as { env: Record<string, string> }).env = {
      JWT_SECRET: "another-secret-with-enough-entropy-here-yes",
      NODE_ENV: "production",
    };

    const { verifyJwt } = await import("../lib/cognito-sso-consumer.js");
    const ctx = {
      cookies: { get: () => undefined },
      request: { headers: new Headers() },
    };
    // No cookie → returns null without throwing.
    const user = await verifyJwt(ctx as never);
    expect(user).toBeNull();
  });

  it("falls back to process.env.JWT_SECRET in Node-only runtime (Vite dev)", async () => {
    // Restore process for this test only — simulates Vite local dev where
    // globalThis.env is undefined but process.env is populated.
    (globalThis as { process: { env: Record<string, string> } }).process = {
      env: { JWT_SECRET: "vite-dev-secret-padding-padding-padding", NODE_ENV: "development" },
    } as never;

    const { verifyJwt } = await import("../lib/cognito-sso-consumer.js");
    const ctx = {
      cookies: { get: () => undefined },
      request: { headers: new Headers() },
    };
    const user = await verifyJwt(ctx as never);
    expect(user).toBeNull(); // no cookie → null regardless
  });
});
