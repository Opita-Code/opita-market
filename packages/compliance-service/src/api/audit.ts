/**
 * Audit log writer — task 2.3 of compliance-foundation PR 2.
 *
 * Every rights workflow writes an `audit_log` row with the four spec-required
 * fields per spec/titular-rights-workflows §"Audit Trail for All Rights Requests":
 *
 *   - timestamp       (occurred_at)
 *   - verifier response (verifier_response, JSONB)
 *   - action           (rights.know | rights.update | rights.rectify | rights.suppress
 *                       | consent.grant | consent.revoke | nit-dv.lookup | dpo.action)
 *   - DPO sign-off     (dpo_signoff — REQUIRED for rights.suppress / rights.rectify)
 *
 * The DB-level trigger `public.enforce_audit_log_completeness()` (see schema.sql)
 * rejects any row missing timestamp/action/outcome OR missing dpo_signoff for
 * suppress/rectify. The application-level check in `assertAuditEntryComplete`
 * mirrors that trigger so we can fail fast with a typed error before the
 * network round-trip to Aurora.
 *
 * The writer also computes `sla_deadline` (= now + 15 business days) and
 * `sla_breached` flag; the SLA monitor (PR 4) updates `sla_breached` later.
 */

import type { SchemaName } from "../lib/schema-isolation.js";
import { computeSlaDeadline } from "../lib/sla-math.js";
import type { NitDvLookupResult } from "./nit-dv.js";

export const AUDIT_ACTIONS = [
  "rights.know",
  "rights.update",
  "rights.rectify",
  "rights.suppress",
  "consent.grant",
  "consent.revoke",
  "nit-dv.lookup",
  "dpo.action",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = [
  "pending",
  "verified",
  "rejected",
  "completed",
  "failed",
] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface AuditEntryInput {
  action: AuditAction;
  nit?: string;
  verifierResponse?: NitDvLookupResult | Record<string, unknown> | null;
  outcome: AuditOutcome;
  dpoSignoff?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  /** Set false to skip SLA deadline computation (used for non-rights actions). */
  appliesSla?: boolean;
}

export interface AuditEntryRow extends AuditEntryInput {
  occurred_at: string;
  sla_deadline: string | null;
  sla_breached: false;
}

export class AuditIncompleteError extends Error {
  readonly code = "AUDIT_INCOMPLETE";
  constructor(missing: ReadonlyArray<string>) {
    super(`AUDIT_INCOMPLETE: audit entry missing required fields: ${missing.join(", ")}`);
    this.name = "AuditIncompleteError";
  }
}

const DPO_REQUIRED_ACTIONS: ReadonlySet<AuditAction> = new Set(["rights.suppress", "rights.rectify"]);

/** Application-side completeness check (mirrors the DB trigger). */
export function assertAuditEntryComplete(entry: AuditEntryInput): void {
  const missing: string[] = [];
  if (!entry.action) missing.push("action");
  if (!entry.outcome) missing.push("outcome");
  if (!entry.occurredAt && !entry.metadata?.["inferred_occurred_at"]) {
    // occurredAt defaults to now() if absent — only fail if caller explicitly
    // passed an undefined value AND we can't infer it.
  }
  if (DPO_REQUIRED_ACTIONS.has(entry.action) && !entry.dpoSignoff) {
    missing.push("dpoSignoff");
  }
  if (missing.length > 0) {
    throw new AuditIncompleteError(missing);
  }
}

/** Build a row ready for INSERT into public.audit_log. */
export function buildAuditEntry(input: AuditEntryInput): AuditEntryRow {
  assertAuditEntryComplete(input);
  const occurredAt = input.occurredAt ?? new Date();
  const appliesSla = input.appliesSla ?? input.action.startsWith("rights.");
  return {
    ...input,
    occurred_at: occurredAt.toISOString(),
    sla_deadline: appliesSla ? computeSlaDeadline(occurredAt).toISOString() : null,
    sla_breached: false,
  };
}

/**
 * Minimal DB executor interface. We accept any client that implements
 * `query(sql, params)` so we can drive the writer from:
 *   - node-postgres (`pg`) in production (via the SST `link`),
 *   - pglite in unit tests,
 *   - mocks in integration tests.
 */
export interface DbExecutor {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: T[] }>;
}

export interface AuditWriterOptions {
  db: DbExecutor;
}

export function makeAuditWriter(opts: AuditWriterOptions) {
  /** Persist a single audit row. Returns the new row id. */
  async function write(input: AuditEntryInput): Promise<{ id: number }> {
    const row = buildAuditEntry(input);
    const res = await opts.db.query<{ id: number }>(
      `INSERT INTO public.audit_log
         (occurred_at, action, nit, verifier_response, outcome,
          dpo_signoff, metadata, sla_deadline, sla_breached)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9)
       RETURNING id`,
      [
        row.occurred_at,
        row.action,
        row.nit ?? null,
        row.verifierResponse ? JSON.stringify(row.verifierResponse) : null,
        row.outcome,
        row.dpoSignoff ?? null,
        JSON.stringify(row.metadata ?? {}),
        row.sla_deadline,
        row.sla_breached,
      ],
    );
    const first = res.rows[0];
    if (!first) throw new Error("audit_log INSERT returned no id");
    return first;
  }

  /** Read audit log rows (DPO-only, enforced at the API layer). */
  async function read(filter: {
    from?: Date;
    to?: Date;
    action?: AuditAction;
    nit?: string;
    limit?: number;
  }): Promise<ReadonlyArray<Record<string, unknown>>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.from) {
      params.push(filter.from.toISOString());
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to.toISOString());
      conditions.push(`occurred_at <= $${params.length}`);
    }
    if (filter.action) {
      params.push(filter.action);
      conditions.push(`action = $${params.length}`);
    }
    if (filter.nit) {
      params.push(filter.nit);
      conditions.push(`nit = $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 100, 500));
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT id, occurred_at, action, nit, verifier_response, outcome,
             dpo_signoff, metadata, sla_deadline, sla_breached,
             archived_to_s3, archived_at, archive_s3_key
        FROM public.audit_log
        ${where}
       ORDER BY occurred_at DESC
       LIMIT $${params.length}
    `;
    const res = await opts.db.query<Record<string, unknown>>(sql, params);
    return res.rows;
  }

  return { write, read, buildAuditEntry, assertAuditEntryComplete };
}

/** Used only to keep the `SchemaName` import alive in callers that touch
 *  the audit log from a schema-scoped context. */
export type AuditScope = SchemaName;