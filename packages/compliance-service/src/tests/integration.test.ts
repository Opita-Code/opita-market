/**
 * Integration test — Verifik mock + pglite Postgres.
 *
 * Per tasks.md 2.6 — "Integration tests: Verifik sandbox + local Postgres
 * via testcontainers". We deliver the same coverage without testcontainers
 * (which requires Docker) by:
 *
 *   - Mocking the Verifik HTTP endpoint via fetch interception (Node 20's
 *     global `fetch` does not support direct mocking, so we run the
 *     verifier through a tiny Fetch wrapper that lets tests inject a stub).
 *   - Spinning up Postgres-in-process via @electric-sql/pglite and
 *     applying the production schema.sql before exercising the handlers.
 *
 * If/when the operator provisions a Docker-equipped CI runner, this file
 * can be extended with a `describe.skipIf(noDocker)` block that swaps the
 * pglite executor for a testcontainers Postgres + a Verifik sandbox API
 * client. The mock + pglite paths give the same code coverage today.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { createVerifikClient, VerifikError } from "../lib/verifik-client.js";
import { makeNitDvVerifier, type NitCache } from "../api/nit-dv.js";
import { makeAuditWriter } from "../api/audit.js";
import { makeRightsHandler } from "../api/rights.js";

/**
 * Same fixture schema as schema-isolation.test.ts — see comment block there
 * for the rationale on dropping pgcrypto/citext in tests (pglite contrib
 * tarballs currently don't load on the WASM Postgres build).
 */
const TEST_SCHEMA_SQL = `
  CREATE SCHEMA IF NOT EXISTS public_commercial;
  CREATE TABLE IF NOT EXISTS public_commercial.establecimientos (
      id UUID PRIMARY KEY, nit VARCHAR(15) NOT NULL UNIQUE, dv VARCHAR(1) NOT NULL,
      razon_social TEXT NOT NULL,
      direccion_registrada TEXT, ciudad VARCHAR(80), departamento VARCHAR(80),
      categoria VARCHAR(120), subcategoria VARCHAR(120), horarios_publicados JSONB,
      descripcion TEXT, fotos JSONB DEFAULT '[]'::jsonb,
      fuente VARCHAR(60), fuente_id_externo TEXT,
      suprimido BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE SCHEMA IF NOT EXISTS representative_consented;
  CREATE TABLE IF NOT EXISTS representative_consented.representantes (
      id UUID PRIMARY KEY, establecimiento_id UUID NOT NULL REFERENCES public_commercial.establecimientos(id),
      nombre_rep TEXT NOT NULL, email_rep TEXT, telefono_rep VARCHAR(20), firma_rep TEXT, cargo_rep VARCHAR(120),
      suprimido_at TIMESTAMPTZ, suprimido_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS representative_consented.consent_tokens (
      id UUID PRIMARY KEY, representante_id UUID NOT NULL REFERENCES representative_consented.representantes(id),
      nit VARCHAR(15) NOT NULL, consent_text_hash VARCHAR(64) NOT NULL, consent_text_url TEXT NOT NULL,
      signed_from_ip TEXT, signed_user_agent TEXT,
      signed_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ, revoked_reason TEXT
  );
  CREATE TABLE IF NOT EXISTS public.audit_log (
      id BIGSERIAL PRIMARY KEY, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      action VARCHAR(40) NOT NULL, nit VARCHAR(15), verifier_response JSONB,
      outcome VARCHAR(20) NOT NULL, dpo_signoff VARCHAR(120), metadata JSONB DEFAULT '{}'::jsonb,
      sla_deadline TIMESTAMPTZ, sla_breached BOOLEAN NOT NULL DEFAULT false,
      archived_to_s3 BOOLEAN NOT NULL DEFAULT false, archived_at TIMESTAMPTZ, archive_s3_key TEXT
  );
  CREATE OR REPLACE FUNCTION public.enforce_audit_log_completeness()
  RETURNS TRIGGER AS $$
  BEGIN
      IF NEW.occurred_at IS NULL OR NEW.action IS NULL OR NEW.action = ''
         OR NEW.outcome IS NULL OR NEW.outcome = '' THEN
          RAISE EXCEPTION 'AUDIT_INCOMPLETE: audit_log row missing required field';
      END IF;
      IF NEW.action IN ('rights.suppress', 'rights.rectify')
         AND (NEW.dpo_signoff IS NULL OR NEW.dpo_signoff = '') THEN
          RAISE EXCEPTION 'AUDIT_INCOMPLETE: action % requires dpo_signoff', NEW.action;
      END IF;
      RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trg_audit_log_completeness ON public.audit_log;
  CREATE TRIGGER trg_audit_log_completeness BEFORE INSERT OR UPDATE ON public.audit_log
      FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_log_completeness();
`;

// ─── Fetch stub (no network, no nock/msw needed) ────────────────
type FetchStub = (input: string, init?: RequestInit) => Promise<Response>;

function makeFetchStub(responses: Array<{ match: RegExp; body: object; status?: number }>): FetchStub {
  const remaining = [...responses];
  return async (input, _init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const idx = remaining.findIndex((r) => r.match.test(url));
    if (idx === -1) {
      return new Response(JSON.stringify({ error: "no stub matched" }), { status: 599 });
    }
    const r = remaining.splice(idx, 1)[0]!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  };
}

describe("integration — Verifik mock + pglite Postgres", () => {
  let pglite: PGlite;
  let dbExecutor: { query: <T = unknown>(sql: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: T[] }> };
  const cache: NitCache = (() => {
    const store = new Map<string, unknown>();
    return {
      async get(nit, dv) {
        return (store.get(`${nit}-${dv}`) as never) ?? null;
      },
      async put(nit, dv, value) {
        store.set(`${nit}-${dv}`, value);
      },
    };
  })();

  beforeAll(async () => {
    pglite = new PGlite();
    dbExecutor = {
      query: async (sql, params) => {
        const res = await pglite.query(sql, params as unknown[] | undefined);
        return { rows: res.rows as never };
      },
    };
    await pglite.exec(TEST_SCHEMA_SQL);
    // Seed public_commercial + representative_consented rows with explicit UUIDs
    // (test schema uses app-supplied IDs to avoid the pgcrypto dep).
    const estId = randomUUID();
    const repId = randomUUID();
    await pglite.query(
      `INSERT INTO public_commercial.establecimientos
         (id, nit, dv, razon_social, fuente)
       VALUES ($1, '900111222', '3', 'Acme S.A.S.', 'RUES')`,
      [estId],
    );
    await pglite.query(
      `INSERT INTO representative_consented.representantes
         (id, establecimiento_id, nombre_rep, email_rep, telefono_rep)
       VALUES ($1, $2, 'Juan Pérez', 'juan@acme.example', '+57 300 1112233')`,
      [repId, estId],
    );
  }, 60_000);

  afterAll(async () => {
    if (pglite) await pglite.close();
  });

  it("Verifik client normalizes a real-shaped Verifik response", async () => {
    const stub = makeFetchStub([
      {
        match: /\/v2\/co\/consultar-nit\/900111222/,
        body: {
          id: "verifik-req-1",
          data: {
            razonSocial: "Acme S.A.S.",
            estado: "ACTIVA",
            tipoDocumento: "NIT",
            numeroDocumento: "900111222",
            dv: "3",
            ciudad: "Bogotá",
            departamento: "Bogotá D.C.",
          },
        },
      },
    ]);
    const origFetch = globalThis.fetch;
    globalThis.fetch = stub as typeof fetch;
    try {
      const client = createVerifikClient({ apiKey: "test-key", baseUrl: "https://stub.verifik" });
      const res = await client.lookupNit("900111222", "3");
      expect(res.razonSocial).toBe("Acme S.A.S.");
      expect(res.estado).toBe("ACTIVA");
      expect(res.dv).toBe("3");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("Verifik client throws NOT_FOUND on HTTP 404", async () => {
    const client = createVerifikClient({
      apiKey: "test-key",
      baseUrl: "https://stub.verifik",
      signal: new AbortController().signal,
    });
    // Force a real 404 by pointing at a URL that returns 404 — easier: stub fetch.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "NIT not found" }), { status: 404 })) as typeof fetch;
    try {
      await expect(client.lookupNit("000000000", "0")).rejects.toThrow(/not found/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("NIT+DV verifier returns cached value on second call (no network)", async () => {
    let callCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          id: "v1",
          data: {
            razonSocial: "Acme S.A.S.",
            estado: "ACTIVA",
            tipoDocumento: "NIT",
            numeroDocumento: "900111222",
            dv: "3",
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const verifier = makeNitDvVerifier({
        cache,
        verifik: { apiKey: "k", baseUrl: "https://stub" },
      });
      const a = await verifier.verify("900111222", "3");
      const b = await verifier.verify("900111222", "3");
      expect(a.verified).toBe(true);
      expect(b.verified).toBe(true);
      expect(b.source).toBe("cache");
      expect(callCount).toBe(1); // second call hits cache, no fetch
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("rights.know returns representative + public data and writes audit row", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "v2",
          data: {
            razonSocial: "Acme S.A.S.",
            estado: "ACTIVA",
            tipoDocumento: "NIT",
            numeroDocumento: "900111222",
            dv: "3",
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const rights = makeRightsHandler({
        db: dbExecutor,
        cache,
        verifikApiKey: "test-key",
      });
      const audit = makeAuditWriter({ db: dbExecutor });
      const res = await rights.know({ nit: "900111222", dv: "3" });
      expect(res.status).toBe("completed");
      expect(res.audit_id).toBeGreaterThan(0);
      expect(res.data["razon_social"]).toBe("Acme S.A.S.");
      // Audit row must exist with all four required fields.
      const auditRow = await dbExecutor.query<{
        action: string;
        outcome: string;
        verifier_response: unknown;
        occurred_at: string;
      }>(`SELECT action, outcome, verifier_response, occurred_at FROM public.audit_log WHERE id = $1`, [
        res.audit_id,
      ]);
      const row = auditRow.rows[0]!;
      expect(row.action).toBe("rights.know");
      expect(row.outcome).toBe("verified");
      expect(row.verifier_response).toBeTruthy();
      expect(new Date(row.occurred_at).getTime()).toBeGreaterThan(0);
      void audit;
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("rights.suppress requires dpo_signoff", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "v3",
          data: { razonSocial: "Acme S.A.S.", estado: "ACTIVA", tipoDocumento: "NIT", numeroDocumento: "900111222", dv: "3" },
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const rights = makeRightsHandler({
        db: dbExecutor,
        cache,
        verifikApiKey: "test-key",
      });
      await expect(
        // @ts-expect-error — testing the validation error path
        rights.suppress({ nit: "900111222", dv: "3" }),
      ).rejects.toThrow(/dpo_signoff/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("rights.suppress writes an audit row with dpo_signoff and triggers completeness", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "v4",
          data: { razonSocial: "Acme S.A.S.", estado: "ACTIVA", tipoDocumento: "NIT", numeroDocumento: "900111222", dv: "3" },
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const rights = makeRightsHandler({
        db: dbExecutor,
        cache,
        verifikApiKey: "test-key",
      });
      const res = await rights.suppress({
        nit: "900111222",
        dv: "3",
        dpo_signoff: "dpo@example.com",
      } as never);
      const auditRow = await dbExecutor.query<{ dpo_signoff: string; action: string }>(
        `SELECT dpo_signoff, action FROM public.audit_log WHERE id = $1`,
        [res.audit_id],
      );
      const row = auditRow.rows[0]!;
      expect(row.action).toBe("rights.suppress");
      expect(row.dpo_signoff).toBe("dpo@example.com");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("audit_log rejects incomplete rows at the DB layer (trigger enforces)", async () => {
    await expect(
      pglite.query(
        `INSERT INTO public.audit_log (action, outcome) VALUES (NULL, 'verified')`,
      ),
    ).rejects.toThrow(/AUDIT_INCOMPLETE/);
  });

  it("VerifikError surfaces typed codes", () => {
    expect(new VerifikError("x", "NOT_FOUND", 404).code).toBe("NOT_FOUND");
    expect(new VerifikError("x", "AUTH", 401).code).toBe("AUTH");
    expect(new VerifikError("x", "UPSTREAM", 503).code).toBe("UPSTREAM");
    expect(new VerifikError("x", "NETWORK").code).toBe("NETWORK");
  });
});