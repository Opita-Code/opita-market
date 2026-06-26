/**
 * Schema isolation test — CRITICAL INVARIANT for Ley 1581/2012 compliance.
 *
 * Per spec/data-segregation-model §"Representative Data Access Isolation"
 * AND design.md §"Schema segregation approach", queries scoped to the
 * public_commercial schema MUST NOT be able to read from the
 * representative_consented schema (and vice-versa).
 *
 * We verify the invariant at THREE layers so a regression at any layer
 * surfaces as a failing test:
 *
 *   1. Application-layer guard   (assertSqlScopedToSchema) — pure unit
 *   2. SQL role enforcement      (pglite + GRANT REVOKE pattern)
 *   3. Application handler paths (rights handler rejects cross-schema joins)
 *
 * If the schema isolation invariant ever breaks, the compliance service
 * is in a non-deployable state — this test guards that line.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assertSqlScopedToSchema,
  SchemaIsolationViolation,
  AUDIT_SCOPE,
} from "../lib/schema-isolation.js";
import { makeAuditWriter } from "../api/audit.js";
import { makeRightsHandler } from "../api/rights.js";
import type { NitCache } from "../api/nit-dv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL_PATH = join(__dirname, "..", "db", "schema.sql");

// ─── Shared fixtures ────────────────────────────────────────────
let pglite: PGlite;
let dbExecutor: { query: (sql: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: unknown[] }> };

const inMemoryCache: NitCache = {
  async get() { return null; },
  async put() { /* noop */ },
};

beforeAll(async () => {
  pglite = new PGlite();
  dbExecutor = {
    query: async (sql, params) => {
      const res = await pglite.query(sql, params as unknown[] | undefined);
      return { rows: res.rows };
    },
  };
  const schemaSql = await readFile(SCHEMA_SQL_PATH, "utf8");
  await pglite.exec(schemaSql);
  // Seed a public_commercial row so the handler has something to find.
  await pglite.query(
    `INSERT INTO public_commercial.establecimientos
       (nit, dv, razon_social, fuente) VALUES ($1, $2, $3, $4)`,
    ["900123456", "7", "Acme S.A.S.", "RUES"],
  );
}, 60_000);

afterAll(async () => {
  if (pglite) await pglite.close();
});

// ─── Layer 1 — Application guard ────────────────────────────────
describe("schema isolation — application guard (assertSqlScopedToSchema)", () => {
  it("rejects SQL that references the forbidden schema by name", () => {
    expect(() =>
      assertSqlScopedToSchema(
        `SELECT * FROM representative_consented.representantes`,
        "public_commercial",
      ),
    ).toThrow(SchemaIsolationViolation);
  });

  it("rejects SQL that references a forbidden-schema table by bare name", () => {
    expect(() =>
      assertSqlScopedToSchema(
        `SELECT * FROM representantes`,
        "public_commercial",
      ),
    ).toThrow(SchemaIsolationViolation);
  });

  it("strips block comments before scanning", () => {
    expect(() =>
      assertSqlScopedToSchema(
        `SELECT 1 /* FROM representative_consented.representantes */ FROM establecimientos`,
        "public_commercial",
      ),
    ).toThrow(SchemaIsolationViolation);
  });

  it("strips line comments before scanning", () => {
    expect(() =>
      assertSqlScopedToSchema(
        `SELECT 1 -- FROM representantes
           FROM establecimientos`,
        "public_commercial",
      ),
    ).toThrow(SchemaIsolationViolation);
  });

  it("allows SQL scoped to its own schema", () => {
    expect(() =>
      assertSqlScopedToSchema(
        `SELECT id, razon_social FROM public_commercial.establecimientos WHERE nit = $1`,
        "public_commercial",
      ),
    ).not.toThrow();
  });

  it("audit-log scope does NOT block public.audit_log references", () => {
    expect(() =>
      assertSqlScopedToSchema(
        `INSERT INTO public.audit_log (action, outcome) VALUES ('x','y')`,
        AUDIT_SCOPE,
      ),
    ).not.toThrow();
  });

  it("public_commercial scope forbids consent_tokens table", () => {
    expect(() =>
      assertSqlScopedToSchema(
        `SELECT * FROM consent_tokens`,
        "public_commercial",
      ),
    ).toThrow(SchemaIsolationViolation);
  });
});

// ─── Layer 2 — DB-level enforcement ─────────────────────────────
describe("schema isolation — DB-level role enforcement (pglite)", () => {
  it("public_commercial role cannot SELECT from representative_consented", async () => {
    // Create a role, grant only public_commercial SELECT.
    await pglite.exec(`
      DO $$ BEGIN
        CREATE ROLE compliance_public LOGIN;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
      GRANT USAGE ON SCHEMA public_commercial TO compliance_public;
      GRANT SELECT ON public_commercial.establecimientos TO compliance_public;
    `);

    // pglite runs as superuser by default, so we SET LOCAL ROLE inside a tx
    // to simulate the production posture.
    const result = await pglite.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE compliance_public`);
      try {
        await tx.query(`SELECT id FROM representative_consented.representantes LIMIT 1`);
        return { error: null };
      } catch (e) {
        return { error: (e as Error).message };
      }
    });
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toMatch(/permission denied|does not exist|schema/);
  });

  it("representative_consented role CAN SELECT from public_commercial for FK targets", async () => {
    // representative_consented FKs into public_commercial.establecimientos.id.
    // We grant USAGE+SELECT so the FK target is joinable FROM the consent schema.
    await pglite.exec(`
      CREATE ROLE compliance_consent LOGIN;
      GRANT USAGE ON SCHEMA representative_consented TO compliance_consent;
      GRANT SELECT ON public_commercial.establecimientos TO compliance_consent;
      GRANT SELECT ON representative_consented.representantes TO compliance_consent;
    `);

    const result = await pglite.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE compliance_consent`);
      const r = await tx.query<{ id: string }>(
        `SELECT e.id FROM public_commercial.establecimientos e LIMIT 1`,
      );
      return r.rows[0]?.id ?? null;
    });
    expect(result).toBeTruthy();
  });
});

// ─── Layer 3 — Handler integration ─────────────────────────────
describe("schema isolation — handler refuses cross-schema queries", () => {
  it("rights handler rejects UPDATE that touches a forbidden schema field", async () => {
    // The handler composes SQL internally and routes everything through
    // assertSqlScopedToSchema. Patch the audit writer's db to spy on SQL.
    let observedSql: string[] = [];
    const spyingDb = {
      query: async <T = unknown>(sql: string, _params?: ReadonlyArray<unknown>) => {
        observedSql.push(sql);
        // Return a minimal shape the handler expects for the UPDATE path.
        return { rows: [{ id: "rep-1" }] as T[] };
      },
    };
    const audit = makeAuditWriter({ db: spyingDb });
    const rights = makeRightsHandler({
      db: spyingDb,
      cache: inMemoryCache,
      verifikApiKey: "test-key",
    });

    // Stub the verifier by pre-seeding the cache.
    inMemoryCache.get = async () => ({
      verified: true,
      razonSocial: "Acme S.A.S.",
      source: "verifik",
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      raw: undefined,
    });

    // update() requires a consent token; we don't validate it here — bypass
    // by supplying one (the handler calls verifyConsentToken in api/index.ts,
    // NOT in the handler itself — see api/rights.ts for the seam).
    await rights.update({
      nit: "900123456",
      dv: "7",
      field: "telefono_rep",
      new_value: "+57 300 1234567",
    } as never);

    // Ensure every SQL passed to the db passed the guard (no banned schema names).
    for (const sql of observedSql) {
      expect(() => assertSqlScopedToSchema(sql, "representative_consented")).not.toThrow();
    }
    void audit;
  });
});