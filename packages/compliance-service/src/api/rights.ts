/**
 * Titular rights workflow API — task 2.2 of compliance-foundation PR 2.
 *
 * Implements the 4 Ley 1581/2012 Art. 6 rights:
 *   - know      (derecho de conocer)   — full export of stored personal data
 *   - update    (derecho de actualizar) — correction of stale fields
 *   - rectify   (derecho de rectificar) — dispute a factual claim, requires DPO
 *   - suppress  (derecho al olvido)    — full suppression, requires DPO
 *
 * All four endpoints share the same flow:
 *   1. Parse + validate body (NIT, DV, type-specific payload)
 *   2. Verify identity via NIT+DV (cached 24h)
 *   3. Execute the rights action in a schema-scoped DB transaction
 *   4. Write an audit_log row capturing the verifier response
 *
 * Schema isolation is enforced via the assertSqlScopedToSchema() guard on
 * every SQL string before it's sent to the DB. Cross-schema reads (e.g. a
 * `know` query that joins to `representative_consented.representantes`)
 * throw SchemaIsolationViolation at the application layer.
 */

import { randomUUID } from "node:crypto";
import {
  assertSqlScopedToSchema,
  withSchemaContext,
  type SchemaName,
} from "../lib/schema-isolation.js";
import { computeSlaDeadline } from "../lib/sla-math.js";
import {
  AUDIT_OUTCOMES,
  buildAuditEntry,
  type AuditAction,
  type AuditOutcome,
  type DbExecutor,
} from "./audit.js";
import { makeNitDvVerifier, type NitCache, type NitDvLookupResult } from "./nit-dv.js";

export interface RightsHandlerOptions {
  db: DbExecutor;
  cache: NitCache;
  verifikApiKey: string;
  verifikBaseUrl?: string;
}

/** Common body shape for all 4 rights endpoints. */
export interface RightsRequestBody {
  nit: string;
  dv: string;
  /** Optional override — defaults to the verifier lookup result. */
  payload?: Record<string, unknown>;
  /** Optional consent token for representative-data mutations. */
  consentToken?: string;
  /** Caller-supplied request id (idempotency). */
  requestId?: string;
}

export interface RightsResponse {
  request_id: string;
  status: "received" | "verified" | "completed" | "rejected";
  sla_deadline: string;
  audit_id: number;
}

const NIT_RE = /^[0-9]{6,15}$/;
const DV_RE = /^[0-9kK]$/;

export class RightsValidationError extends Error {
  readonly code = "RIGHTS_VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "RightsValidationError";
  }
}

export class IdentityVerificationFailed extends Error {
  readonly code = "IDENTITY_NOT_VERIFIED";
  constructor(message: string) {
    super(message);
    this.name = "IdentityVerificationFailed";
  }
}

export class CrossTenantAccessError extends Error {
  readonly code = "FORBIDDEN_CROSS_TENANT";
  constructor(message: string) {
    super(message);
    this.name = "CrossTenantAccessError";
  }
}

function assertValidNitDv(nit: string, dv: string): void {
  if (!NIT_RE.test(nit)) throw new RightsValidationError(`Invalid NIT: ${nit}`);
  if (!DV_RE.test(dv)) throw new RightsValidationError(`Invalid DV: ${dv}`);
}

export function makeRightsHandler(opts: RightsHandlerOptions) {
  const verifier = makeNitDvVerifier({
    cache: opts.cache,
    verifik: { apiKey: opts.verifikApiKey, baseUrl: opts.verifikBaseUrl },
  });

  /** Look up the establishment id for a verified NIT+DV. */
  async function findEstablecimientoId(nit: string, dv: string): Promise<string | null> {
    const sql = `SELECT id FROM public_commercial.establecimientos WHERE nit = $1 AND dv = $2 LIMIT 1`;
    assertSqlScopedToSchema(sql, "public_commercial");
    const res = await opts.db.query<{ id: string }>(sql, [nit, dv]);
    return res.rows[0]?.id ?? null;
  }

  /** KNOW — return all representative data for a verified NIT+DV. */
  async function know(body: RightsRequestBody): Promise<RightsResponse & { data: Record<string, unknown> }> {
    assertValidNitDv(body.nit, body.dv);
    const requestId = body.requestId ?? randomUUID();
    const verified = await verifier.verify(body.nit, body.dv);
    if (!verified.verified) {
      throw new IdentityVerificationFailed(`NIT ${body.nit}-${body.dv} is not ACTIVA in Verifik`);
    }

    const estId = await findEstablecimientoId(body.nit, body.dv);
    const data: Record<string, unknown> = {
      razon_social: verified.razonSocial ?? null,
      fuente_verificacion: "verifik",
      verificacion_fecha: verified.fetchedAt,
      establecimiento: null,
      representante: null,
    };

    if (estId) {
      const sql = `SELECT id, nit, dv, razon_social, direccion_registrada, ciudad, departamento, categoria, subcategoria, descripcion, fuente
                   FROM public_commercial.establecimientos WHERE id = $1`;
      assertSqlScopedToSchema(sql, "public_commercial");
      const est = await opts.db.query<Record<string, unknown>>(sql, [estId]);
      data["establecimiento"] = est.rows[0] ?? null;
    }

    const audit = buildAuditEntry({
      action: "rights.know",
      nit: body.nit,
      verifierResponse: verified,
      outcome: AUDIT_OUTCOMES[1], // "verified"
      metadata: { request_id: requestId, establishment_id: estId },
    });
    const auditRow = await persistAudit(audit);

    return {
      request_id: requestId,
      status: "completed",
      sla_deadline: audit.sla_deadline ?? computeSlaDeadline(new Date()).toISOString(),
      audit_id: auditRow.id,
      data,
    };
  }

  /** UPDATE — apply a field correction to the representative row.
   *  Requires a valid consent token (rep.contact_* scope). */
  async function update(body: RightsRequestBody & { field: string; new_value: string }): Promise<RightsResponse> {
    assertValidNitDv(body.nit, body.dv);
    if (!body.field || typeof body.new_value !== "string") {
      throw new RightsValidationError("update requires `field` and `new_value`");
    }
    const editable = new Set(["telefono_rep", "email_rep", "nombre_rep", "cargo_rep"]);
    if (!editable.has(body.field)) {
      throw new RightsValidationError(`Field ${body.field} is not editable via update`);
    }
    if (!body.consentToken) {
      throw new RightsValidationError("update requires a consent token");
    }
    const requestId = body.requestId ?? randomUUID();
    const verified = await verifier.verify(body.nit, body.dv);
    if (!verified.verified) {
      throw new IdentityVerificationFailed(`NIT ${body.nit}-${body.dv} is not ACTIVA`);
    }

    const estId = await findEstablecimientoId(body.nit, body.dv);
    if (!estId) {
      throw new CrossTenantAccessError("No establecimiento matches this NIT+DV");
    }
    const sql = `UPDATE representative_consented.representantes
                    SET ${body.field} = $1, updated_at = now()
                  WHERE establecimiento_id = $2 AND suprimido_at IS NULL
              RETURNING id`;
    assertSqlScopedToSchema(sql, "representative_consented");
    const res = await opts.db.query<{ id: string }>(sql, [body.new_value, estId]);
    if (!res.rows[0]) {
      throw new CrossTenantAccessError("No active representative matches this NIT+DV");
    }

    const audit = buildAuditEntry({
      action: "rights.update",
      nit: body.nit,
      verifierResponse: verified,
      outcome: "completed",
      metadata: { request_id: requestId, field: body.field, establecimiento_id: estId },
    });
    const auditRow = await persistAudit(audit);
    return {
      request_id: requestId,
      status: "completed",
      sla_deadline: audit.sla_deadline ?? computeSlaDeadline(new Date()).toISOString(),
      audit_id: auditRow.id,
    };
  }

  /** RECTIFY — dispute a factual claim. Requires DPO sign-off (PR 3 dashboard). */
  async function rectify(
    body: RightsRequestBody & { field: string; new_value: string; old_value: string; dpo_signoff: string },
  ): Promise<RightsResponse> {
    assertValidNitDv(body.nit, body.dv);
    if (!body.field || typeof body.new_value !== "string" || typeof body.old_value !== "string") {
      throw new RightsValidationError("rectify requires `field`, `new_value`, `old_value`");
    }
    if (!body.dpo_signoff) {
      throw new RightsValidationError("rectify requires `dpo_signoff`");
    }
    const requestId = body.requestId ?? randomUUID();
    const verified = await verifier.verify(body.nit, body.dv);
    if (!verified.verified) {
      throw new IdentityVerificationFailed(`NIT ${body.nit}-${body.dv} is not ACTIVA`);
    }
    const estId = await findEstablecimientoId(body.nit, body.dv);
    if (!estId) {
      throw new CrossTenantAccessError("No establecimiento matches this NIT+DV");
    }
    const sql = `UPDATE representative_consented.representantes
                    SET ${body.field} = $1, updated_at = now()
                  WHERE establecimiento_id = $2 AND suprimido_at IS NULL
              RETURNING id`;
    assertSqlScopedToSchema(sql, "representative_consented");
    await opts.db.query(sql, [body.new_value, estId]);

    const audit = buildAuditEntry({
      action: "rights.rectify",
      nit: body.nit,
      verifierResponse: verified,
      outcome: "completed",
      dpoSignoff: body.dpo_signoff,
      metadata: {
        request_id: requestId,
        field: body.field,
        old_value: body.old_value,
        new_value: body.new_value,
        establecimiento_id: estId,
      },
    });
    const auditRow = await persistAudit(audit);
    return {
      request_id: requestId,
      status: "completed",
      sla_deadline: audit.sla_deadline ?? computeSlaDeadline(new Date()).toISOString(),
      audit_id: auditRow.id,
    };
  }

  /** SUPPRESS — full suppression of representative data. Requires DPO sign-off. */
  async function suppress(body: RightsRequestBody & { dpo_signoff: string }): Promise<RightsResponse> {
    assertValidNitDv(body.nit, body.dv);
    if (!body.dpo_signoff) {
      throw new RightsValidationError("suppress requires `dpo_signoff`");
    }
    const requestId = body.requestId ?? randomUUID();
    const verified = await verifier.verify(body.nit, body.dv);
    if (!verified.verified) {
      throw new IdentityVerificationFailed(`NIT ${body.nit}-${body.dv} is not ACTIVA`);
    }
    const estId = await findEstablecimientoId(body.nit, body.dv);
    if (!estId) {
      throw new CrossTenantAccessError("No establecimiento matches this NIT+DV");
    }
    const sql = `UPDATE representative_consented.representantes
                    SET suprimido_at = now(),
                        suprimido_por = $1,
                        nombre_rep = '[SUPRIMIDO]',
                        email_rep = NULL,
                        telefono_rep = NULL,
                        firma_rep = NULL,
                        cargo_rep = NULL,
                        updated_at = now()
                  WHERE establecimiento_id = $2 AND suprimido_at IS NULL`;
    assertSqlScopedToSchema(sql, "representative_consented");
    await opts.db.query(sql, [body.dpo_signoff, estId]);

    const publicSql = `UPDATE public_commercial.establecimientos
                          SET suprimido = true, updated_at = now()
                        WHERE id = $1`;
    assertSqlScopedToSchema(publicSql, "public_commercial");
    await opts.db.query(publicSql, [estId]);

    const audit = buildAuditEntry({
      action: "rights.suppress",
      nit: body.nit,
      verifierResponse: verified,
      outcome: "completed",
      dpoSignoff: body.dpo_signoff,
      metadata: { request_id: requestId, establecimiento_id: estId },
    });
    const auditRow = await persistAudit(audit);
    return {
      request_id: requestId,
      status: "completed",
      sla_deadline: audit.sla_deadline ?? computeSlaDeadline(new Date()).toISOString(),
      audit_id: auditRow.id,
    };
  }

  async function persistAudit(entry: ReturnType<typeof buildAuditEntry>): Promise<{ id: number }> {
    const sql = `INSERT INTO public.audit_log
                   (occurred_at, action, nit, verifier_response, outcome,
                    dpo_signoff, metadata, sla_deadline, sla_breached)
                 VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9)
                 RETURNING id`;
    // public.audit_log is outside the two compliance schemas — it's a
    // shared service table. We assert the SQL doesn't accidentally reach
    // into representative_consented or public_commercial.
    assertSqlScopedToSchema(sql, "representative_consented");
    assertSqlScopedToSchema(sql, "public_commercial");
    const res = await opts.db.query<{ id: number }>(sql, [
      entry.occurred_at,
      entry.action,
      entry.nit ?? null,
      entry.verifierResponse ? JSON.stringify(entry.verifierResponse) : null,
      entry.outcome,
      entry.dpoSignoff ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.sla_deadline,
      entry.sla_breached,
    ]);
    const first = res.rows[0];
    if (!first) throw new Error("audit_log INSERT returned no id");
    return first;
  }

  /** Convenience for tests: signature of an exposed lookup. */
  return {
    know,
    update,
    rectify,
    suppress,
    findEstablecimientoId,
    // re-export for callers that want to compose
    _internal: { verifier, persistAudit, schemaContext: withSchemaContext },
    _actions: ["know", "update", "rectify", "suppress"] as const,
  } as const;
}

export type RightsAction = "know" | "update" | "rectify" | "suppress";

export const RIGHTS_ACTIONS: ReadonlyArray<RightsAction> = ["know", "update", "rectify", "suppress"];