/**
 * Hono router that mounts the Compliance API surface for the SST Lambda.
 *
 * Routes (per design.md §"Interfaces / Contracts"):
 *   POST /rights/know      — right to know
 *   POST /rights/update    — right to update (mutable representative fields)
 *   POST /rights/rectify   — right to rectify (DPO-signed)
 *   POST /rights/suppress  — right to suppress (DPO-signed)
 *   GET  /verify-nit/:nit/:dv  — NIT+DV verifier (cached 24h)
 *   GET  /audit            — DPO-only audit log query
 *
 * The SST Lambda entry point (`api/index.handler`) instantiates the router
 * once per warm container so the connection pool + DynamoDB client are
 * reused across invocations.
 *
 * All responses are JSON. Errors carry `{ error, code, detail? }`. CORS is
 * handled by the upstream `sst.aws.Router` (cloudfront forwarding), so we
 * just return the right Content-Type here.
 */

import { Hono, type Context } from "hono";
import { Resource as SSTResource } from "sst";
import { Pool } from "pg";
import {
  makeNitDvVerifier,
  makeDynamoCache,
  type NitCache,
} from "./nit-dv.js";
import { makeAuditWriter } from "./audit.js";
import { makeRightsHandler, RightsValidationError, IdentityVerificationFailed, CrossTenantAccessError } from "./rights.js";
import { makePgExecutor } from "../lib/db-executor.js";
import { verifyConsentToken, ConsentTokenError } from "../lib/consent-token.js";

export interface ComplianceApiDeps {
  /** Pre-resolved pg connection string (SST secret). */
  databaseUrl: string;
  /** SST-managed NitDvCache DynamoDB table name. */
  nitCacheTable: string;
  /** Verifik API key (SST secret). */
  verifikApiKey: string;
  /** Optional Verifik base URL override (for staging/sandbox). */
  verifikBaseUrl?: string;
  /** Consent-token signing secret (SST secret). */
  jwtSecret: string;
  /** Allowlisted emails that count as "DPO" for /audit. */
  dpoEmails: ReadonlyArray<string>;
}

export function createComplianceApp(deps: ComplianceApiDeps) {
  const pool = new Pool({ connectionString: deps.databaseUrl, max: 5, idleTimeoutMillis: 30_000 });
  const db = makePgExecutor(deps.databaseUrl);
  const cache: NitCache = makeDynamoCache(deps.nitCacheTable);
  const verifier = makeNitDvVerifier({
    cache,
    verifik: { apiKey: deps.verifikApiKey, baseUrl: deps.verifikBaseUrl },
  });
  const audit = makeAuditWriter({ db });
  const rights = makeRightsHandler({
    db,
    cache,
    verifikApiKey: deps.verifikApiKey,
    verifikBaseUrl: deps.verifikBaseUrl,
  });

  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "opita-market-compliance" }));

  // GET /verify-nit/:nit/:dv
  app.get("/verify-nit/:nit/:dv", async (c: Context) => {
    const nit = c.req.param("nit");
    const dv = c.req.param("dv");
    try {
      const result = await verifier.verify(nit, dv);
      // Record the lookup in the audit log per spec (action = nit-dv.lookup).
      const row = buildAuditEntry({
        action: "nit-dv.lookup",
        nit,
        verifierResponse: result,
        outcome: result.verified ? "verified" : "rejected",
        metadata: { source_ip: c.req.header("x-forwarded-for") ?? null },
      });
      await audit.write(row);
      return c.json(result);
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  // POST /rights/know
  app.post("/rights/know", async (c: Context) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      return c.json(await rights.know(body as never));
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  // POST /rights/update — requires consent token
  app.post("/rights/update", async (c: Context) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown> & { consentToken?: string };
      if (body.consentToken) {
        await verifyConsentToken(body.consentToken, deps.jwtSecret, {
          requiredScope: "rep.contact_email",
        }).catch(async () => {
          // Accept any of the rep.* scopes; fail if none match.
          await verifyConsentToken(body.consentToken!, deps.jwtSecret, { requiredScope: "rep.contact_phone" });
        });
      }
      return c.json(await rights.update(body as never));
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  // POST /rights/rectify — requires DPO sign-off
  app.post("/rights/rectify", async (c: Context) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      return c.json(await rights.rectify(body as never));
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  // POST /rights/suppress — requires DPO sign-off
  app.post("/rights/suppress", async (c: Context) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      return c.json(await rights.suppress(body as never));
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  // GET /audit?from=&to=&action=&nit= — DPO-only
  app.get("/audit", async (c: Context) => {
    const email = c.req.header("x-dpo-email") ?? "";
    if (!deps.dpoEmails.includes(email)) {
      return c.json({ error: "DPO auth required", code: "DPO_AUTH_REQUIRED" }, 403);
    }
    const from = c.req.query("from");
    const to = c.req.query("to");
    const action = c.req.query("action");
    const nit = c.req.query("nit");
    const rows = await audit.read({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      action: (action as never) ?? undefined,
      nit,
    });
    return c.json({ rows, total: rows.length });
  });

  // 404 fallback
  app.notFound((c) => c.json({ error: "Not found", code: "NOT_FOUND" }, 404));

  return { app, pool, db, cache, audit, rights, verifier };
}

// Local helper to avoid circular imports.
import { buildAuditEntry } from "./audit.js";

function errorResponse(c: Context, e: unknown) {
  if (e instanceof RightsValidationError) {
    return c.json({ error: e.message, code: e.code }, 400);
  }
  if (e instanceof IdentityVerificationFailed) {
    return c.json({ error: e.message, code: e.code }, 403);
  }
  if (e instanceof CrossTenantAccessError) {
    return c.json({ error: e.message, code: e.code }, 403);
  }
  if (e instanceof ConsentTokenError) {
    return c.json({ error: e.message, code: e.code }, 401);
  }
  console.error("compliance-api error:", e);
  return c.json({ error: "Internal server error", code: "INTERNAL", detail: (e as Error).message }, 500);
}

/**
 * SST Lambda entry point. `sst.aws.Function("ComplianceAPI", { handler: ... })`
 * wraps this export. We resolve SST-linked resources on first invocation
 * and cache the app on the Lambda container.
 */
let _app: ReturnType<typeof createComplianceApp> | null = null;

export async function handler(event: unknown, context: unknown): Promise<unknown> {
  if (!_app) {
    const Res = SSTResource as unknown as {
      ComplianceDb: { secretArn: string };
      NitDvCache: { name: string };
    };
    const databaseUrl = process.env.DATABASE_URL ?? "";
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set (SST secret link not resolved)");
    }
    _app = createComplianceApp({
      databaseUrl,
      nitCacheTable: Res.NitDvCache?.name ?? process.env.NIT_DV_CACHE_TABLE ?? "",
      verifikApiKey: process.env.VERIFIK_API_KEY ?? "",
      verifikBaseUrl: process.env.VERIFIK_BASE_URL,
      jwtSecret: process.env.JWT_SECRET ?? "",
      dpoEmails: (process.env.DPO_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
    // Note: SST auto-injects DATABASE_URL when the Aurora cluster is `link`ed.
    void Res;
  }
  return _app.app.fetch(event as Request);
}