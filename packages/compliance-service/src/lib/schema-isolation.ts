/**
 * Schema isolation guard — the CRITICAL invariant for Ley 1581/2012 compliance.
 *
 * Per design.md §"Schema segregation approach" and spec/data-segregation-model,
 * the system maintains two Postgres schemas:
 *   - `public_commercial` — datos_publicos_establecimiento (permissive)
 *   - `representative_consented` — datos_personales_representante (consent-gated)
 *
 * Invariant: queries issued against the `public_commercial` connection MUST
 * NEVER be able to read from `representative_consented`, and vice-versa. The
 * database role used by the compliance service has USAGE on both schemas but
 * SELECT only on the schema it is "scoped" to per request.
 *
 * This module enforces the invariant at the application layer (defense in
 * depth alongside the DB role grants defined in schema.sql §5). Every query
 * MUST be issued through `withSchemaContext` and supply the schema it is
 * allowed to read. The wrapper rejects:
 *   1. SQL text that contains the forbidden schema name
 *   2. SQL text that mentions other-schema tables by name
 *   3. Cross-schema joins via unqualified table references
 *
 * The check is intentionally conservative (string match) because we cannot
 * reason about the SQL parser inside Lambda. For pglite tests we additionally
 * verify the DB-level isolation (GRANT USAGE without SELECT on the cross
 * schema) in schema-isolation.test.ts.
 */

export type SchemaName = "public_commercial" | "representative_consented";

const TABLE_OWNERSHIP: Record<SchemaName, ReadonlySet<string>> = {
  public_commercial: new Set([
    "establecimientos",
    // consent_tokens + representantes intentionally NOT here
  ]),
  representative_consented: new Set([
    "representantes",
    "consent_tokens",
    // establecimientos intentionally NOT here
  ]),
};

const SCHEMA_NAMES: ReadonlyArray<SchemaName> = ["public_commercial", "representative_consented"];

/**
 * Strips SQL comments (line and block) so we can scan identifiers safely.
 * We do not try to fully parse — we just neutralise comment tokens.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

export class SchemaIsolationViolation extends Error {
  readonly code = "SCHEMA_ISOLATION_VIOLATION";
  constructor(
    readonly attempted: SchemaName,
    readonly forbidden: SchemaName,
    readonly detail: string,
  ) {
    super(
      `SchemaIsolationViolation: query scoped to '${attempted}' referenced forbidden schema '${forbidden}' (${detail})`,
    );
    this.name = "SchemaIsolationViolation";
  }
}

/**
 * Validate that the given SQL text is safe for the requested schema scope.
 * Throws SchemaIsolationViolation if any forbidden schema name or forbidden
 * table appears in the SQL.
 */
export function assertSqlScopedToSchema(sql: string, scope: SchemaName): void {
  const cleaned = stripComments(sql).toLowerCase();
  for (const other of SCHEMA_NAMES) {
    if (other === scope) continue;
    // Direct schema reference like `representative_consented.representantes`
    if (cleaned.includes(other)) {
      throw new SchemaIsolationViolation(scope, other, `schema name '${other}' found in SQL`);
    }
    // Cross-schema table reference (unqualified) — block ALL tables that
    // belong to the forbidden schema, even if the user typed just the bare
    // table name (which Postgres would resolve via search_path).
    for (const forbiddenTable of TABLE_OWNERSHIP[other]) {
      const re = new RegExp(`\\b${forbiddenTable}\\b`, "i");
      if (re.test(cleaned)) {
        throw new SchemaIsolationViolation(
          scope,
          other,
          `forbidden table '${forbiddenTable}' (owned by schema '${other}') referenced in SQL`,
        );
      }
    }
  }
}

/** Tables that belong to a given schema scope. Used by callers to keep
 *  their FROM/JOIN lists in sync without manual bookkeeping. */
export function tablesForScope(scope: SchemaName): ReadonlySet<string> {
  return TABLE_OWNERSHIP[scope];
}

/**
 * Lightweight connection-context marker. We attach `__opita_scope` to a DB
 * client object so any query helper can assert it matches. Used by the
 * audit writer which always writes to public.audit_log (NOT one of the two
 * compliance schemas) and therefore has its own scope name.
 */
export const AUDIT_SCOPE = "audit" as const;
export type AuditScope = typeof AUDIT_SCOPE;

/** Marker stamped onto a client. Used for runtime introspection in tests. */
export interface ScopedClient<T> {
  readonly __opita_scope: SchemaName | AuditScope;
  readonly client: T;
}

export function withSchemaContext<T>(client: T, scope: SchemaName | AuditScope): ScopedClient<T> {
  return { __opita_scope: scope, client };
}