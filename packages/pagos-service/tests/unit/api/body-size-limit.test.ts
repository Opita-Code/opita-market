/**
 * Tests for body size limit middleware (closes OPL-API-007).
 *
 * Hono's default config has no body size cap, allowing an unauthenticated
 * attacker to send arbitrarily large JSON payloads to any POST endpoint.
 * This can OOM the Lambda function, slow cold start, or burn CPU on
 * deeply nested object parsing.
 *
 * Fix:
 *   - Add `bodySizeLimitMiddleware` that checks `Content-Length` header
 *     and rejects (413 Payload Too Large) before any handler work.
 *   - For chunked requests (no Content-Length), enforce streaming cap
 *     via `MAX_BODY_BYTES` env var (default 100 KB).
 *   - Apply to ALL routes via `app.use("*", ...)`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { bodySizeLimit, MAX_BODY_BYTES, BodyTooLargeError } from "../../../src/lib/body-size-limit";
import { handleError } from "../../../src/lib/http-errors";

function makeApp() {
  const app = new Hono();
  app.use("*", bodySizeLimit());
  app.post("/echo", async (c) => {
    const body = await c.req.json();
    return c.json({ received: true, size: JSON.stringify(body).length });
  });
  app.onError((err, c) => handleError(err, c));
  return app;
}

describe("body size limit — OPL-API-007 closure", () => {
  let app: Hono;

  beforeEach(() => {
    app = makeApp();
  });

  it("rejects requests with Content-Length > MAX_BODY_BYTES (413)", async () => {
    const huge = "x".repeat(MAX_BODY_BYTES + 1);
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(huge.length),
      },
      body: `{"data":"${huge}"}`,
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error_code).toBe("BODY_TOO_LARGE");
    // No info leak about exact size
    expect(body.message).not.toContain(String(MAX_BODY_BYTES));
  });

  it("accepts requests with Content-Length <= MAX_BODY_BYTES (200)", async () => {
    const small = "x".repeat(100);
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(`{"data":"${small}"}`.length),
      },
      body: `{"data":"${small}"}`,
    });
    expect(res.status).toBe(200);
  });

  it("accepts requests with no Content-Length but small body (chunked-safe)", async () => {
    // Some Lambda clients send without Content-Length when using transfer-encoding chunked
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"data":"small"}',
    });
    expect(res.status).toBe(200);
  });

  it("rejects GET requests with huge query params (defensive)", async () => {
    const huge = "x".repeat(MAX_BODY_BYTES + 1);
    const res = await app.request(`/?data=${huge}`);
    // GET requests are not blocked by the body size limit (no body)
    // — URL length limit is enforced by Lambda/API Gateway separately
    expect(res.status).toBe(404);  // No GET route — 404 from Hono
  });

  it("uses BodyTooLargeError with safe message (no size leak)", () => {
    const err = new BodyTooLargeError();
    expect(err.code).toBe("BODY_TOO_LARGE");
    expect(err.httpStatus).toBe(413);
    expect(err.message).not.toContain(String(MAX_BODY_BYTES));
  });

  it("default MAX_BODY_BYTES is 100 KB (reasonable for JSON APIs)", () => {
    expect(MAX_BODY_BYTES).toBe(100 * 1024);
  });

  it("allows custom MAX_BODY_BYTES via parameter (webhook can be larger)", async () => {
    const customApp = new Hono();
    customApp.use("*", bodySizeLimit({ maxBytes: 1024 })); // 1 KB
    customApp.post("/echo", async (c) => c.json({ ok: true }));
    customApp.onError((err, c) => handleError(err, c));

    // 2 KB body — should be rejected with 1 KB limit
    const huge = "x".repeat(2000);
    const res = await customApp.request("/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(`{"d":"${huge}"}`.length),
      },
      body: `{"d":"${huge}"}`,
    });
    expect(res.status).toBe(413);
  });

  it("rejects malformed Content-Length (non-numeric) — treated as too large", async () => {
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "not-a-number",
      },
      body: '{"d":"x"}',
    });
    // 413 — defensive: treat malformed as oversized (safer than passing through)
    expect(res.status).toBe(413);
  });
});
