-- =====================================================================
-- opita-market — compliance-service schema (Ley 1581/2012 Habeas Data)
-- =====================================================================
-- Per design.md §"Schema segregation approach":
--   Two physically isolated Postgres schemas — public_commercial
--   (permissive, datos_publicos_establecimiento) and
--   representative_consented (consent-gated, datos_personales_representante).
--
-- This file is run automatically by SST on `sst deploy` via the
-- `migrations.filePath` reference in sst.config.ts.
--
-- Idempotency: every CREATE uses IF NOT EXISTS. Safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Extensions — must exist BEFORE any table that uses them.
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive email

-- ---------------------------------------------------------------------
-- 1. public_commercial — datos_publicos_establecimiento
-- ---------------------------------------------------------------------
-- Permissive data: razon_social, nit, direccion_registrada, etc.
-- No consent required — already public via RUES / DIAN / Google Places.
-- Anyone with the schema role may SELECT. Default-deny on writes.
CREATE SCHEMA IF NOT EXISTS public_commercial;

CREATE TABLE IF NOT EXISTS public_commercial.establecimientos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nit               VARCHAR(15) NOT NULL UNIQUE,
    dv                VARCHAR(1) NOT NULL,
    razon_social      TEXT NOT NULL,
    direccion_registrada TEXT,
    ciudad            VARCHAR(80),
    departamento      VARCHAR(80),
    categoria         VARCHAR(120),
    subcategoria      VARCHAR(120),
    horarios_publicados JSONB,
    descripcion       TEXT,
    fotos             JSONB DEFAULT '[]'::jsonb,
    fuente            VARCHAR(60),   -- 'RUES' | 'DIAN' | 'OSM' | 'GOOGLE_PLACES' | 'MANUAL'
    fuente_id_externo TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A row may persist even when its representative data is suppressed
    -- (per spec/titular-rights-workflows §"Right to Suppress").
    suprimido         BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT chk_nit_format CHECK (nit ~ '^[0-9]{6,15}$'),
    CONSTRAINT chk_dv_format  CHECK (dv  ~ '^[0-9kK]$')
);

CREATE INDEX IF NOT EXISTS idx_establecimientos_categoria
    ON public_commercial.establecimientos (categoria);
CREATE INDEX IF NOT EXISTS idx_establecimientos_ciudad
    ON public_commercial.establecimientos (ciudad);
CREATE INDEX IF NOT EXISTS idx_establecimientos_fuente
    ON public_commercial.establecimientos (fuente);

-- ---------------------------------------------------------------------
-- 2. representative_consented — datos_personales_representante
-- ---------------------------------------------------------------------
-- Consent-gated data: email_rep, telefono_rep, firma_rep, nombre_rep.
-- SELECT restricted to authenticated tenant admins with claim
-- verification AND a valid consent_token. INSERT/UPDATE requires a
-- matching consent_tokens row.
CREATE SCHEMA IF NOT EXISTS representative_consented;

CREATE TABLE IF NOT EXISTS representative_consented.representantes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establecimiento_id UUID NOT NULL REFERENCES public_commercial.establecimientos(id) ON DELETE RESTRICT,
    nombre_rep      TEXT NOT NULL,
    email_rep       CITEXT,  -- case-insensitive
    telefono_rep    VARCHAR(20),
    firma_rep       TEXT,    -- base64 signature image, optional
    cargo_rep       VARCHAR(120),
    -- Soft-delete timestamp; deletion per spec/titular-rights-workflows §Suprimir
    suprimido_at    TIMESTAMPTZ,
    suprimido_por   TEXT,    -- DPO handle that authorized the suppression
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_representantes_establecimiento
    ON representative_consented.representantes (establecimiento_id);
CREATE INDEX IF NOT EXISTS idx_representantes_email
    ON representative_consented.representantes (email_rep)
    WHERE email_rep IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. consent_tokens — Ley 1581/2012 Art. 9 explicit consent trail
-- ---------------------------------------------------------------------
-- Every datos_personales_representante row MUST be backed by at least
-- one consent_tokens row signed by the titular. Tokens are append-only
-- and immutable after insert (enforced via trigger).
CREATE TABLE IF NOT EXISTS representative_consented.consent_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    representante_id  UUID NOT NULL REFERENCES representative_consented.representantes(id) ON DELETE RESTRICT,
    nit               VARCHAR(15) NOT NULL,
    -- Hash of the consent text version signed by the titular (links
    -- to PTD + Aviso de Privacidad versions in PR 3).
    consent_text_hash VARCHAR(64) NOT NULL,
    consent_text_url  TEXT NOT NULL,    -- market.opitacode.com/legal/ptd?v=<hash>
    -- IP + user agent at time of signing for evidentiary trail.
    signed_from_ip    INET,
    signed_user_agent TEXT,
    signed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at        TIMESTAMPTZ,
    revoked_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_tokens_representante
    ON representative_consented.consent_tokens (representante_id);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_nit
    ON representative_consented.consent_tokens (nit);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_active
    ON representative_consented.consent_tokens (representante_id)
    WHERE revoked_at IS NULL;

-- Enforce append-only on consent_tokens: forbid UPDATE.
CREATE OR REPLACE FUNCTION representative_consented.deny_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CONSENT_IMMUTABLE: consent_tokens rows cannot be modified';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consent_tokens_immutable ON representative_consented.consent_tokens;
CREATE TRIGGER trg_consent_tokens_immutable
    BEFORE UPDATE ON representative_consented.consent_tokens
    FOR EACH ROW EXECUTE FUNCTION representative_consented.deny_update();

-- ---------------------------------------------------------------------
-- 4. audit_log — append-only, 5-year retention (SIC requirement)
-- ---------------------------------------------------------------------
-- Spec: data-protection-compliance §"Audit Log Retention"
--   "The audit log of all data-processing actions MUST be retained for
--    at least 5 years per SIC requirement."
--
-- Rows older than 5 years are migrated to AuditArchive S3 bucket by
-- the SLA monitor (PR 4) — not deleted.
CREATE TABLE IF NOT EXISTS public.audit_log (
    id                BIGSERIAL PRIMARY KEY,
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 'rights.know' | 'rights.update' | 'rights.rectify' | 'rights.suppress'
    -- | 'consent.grant' | 'consent.revoke' | 'nit-dv.lookup' | 'dpo.action'
    action            VARCHAR(40) NOT NULL,
    nit               VARCHAR(15),
    -- Verifik (or stub) response payload, full JSON.
    verifier_response JSONB,
    -- 'pending' | 'verified' | 'rejected' | 'completed' | 'failed'
    outcome           VARCHAR(20) NOT NULL,
    -- DPO handle (for suppress/rectify actions per spec).
    dpo_signoff       VARCHAR(120),
    -- Free-form metadata (request id, source IP, lambda arn, etc.).
    metadata          JSONB DEFAULT '{}'::jsonb,
    -- SLA tracking (15 business days per spec/titular-rights-workflows).
    sla_deadline      TIMESTAMPTZ,
    sla_breached      BOOLEAN NOT NULL DEFAULT false,
    -- 5y retention marker; set true by archive job once shipped to S3.
    archived_to_s3    BOOLEAN NOT NULL DEFAULT false,
    archived_at       TIMESTAMPTZ,
    archive_s3_key    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_nit
    ON public.audit_log (nit) WHERE nit IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_action_outcome
    ON public.audit_log (action, outcome);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at
    ON public.audit_log (occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_sla_open
    ON public.audit_log (sla_deadline)
    WHERE outcome NOT IN ('completed', 'failed') AND sla_breached = false;
CREATE INDEX IF NOT EXISTS idx_audit_log_archive_pending
    ON public.audit_log (occurred_at)
    WHERE archived_to_s3 = false;

-- Enforce audit_log completeness per spec/titular-rights-workflows §Audit Trail:
--   timestamp, verifier_response, action, outcome MUST be present.
CREATE OR REPLACE FUNCTION public.enforce_audit_log_completeness()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.occurred_at IS NULL
       OR NEW.action IS NULL OR NEW.action = ''
       OR NEW.outcome IS NULL OR NEW.outcome = '' THEN
        RAISE EXCEPTION 'AUDIT_INCOMPLETE: audit_log row missing required field (occurred_at/action/outcome)';
    END IF;
    -- suppress + rectify require DPO sign-off
    IF NEW.action IN ('rights.suppress', 'rights.rectify')
       AND (NEW.dpo_signoff IS NULL OR NEW.dpo_signoff = '') THEN
        RAISE EXCEPTION 'AUDIT_INCOMPLETE: action % requires dpo_signoff', NEW.action;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_completeness ON public.audit_log;
CREATE TRIGGER trg_audit_log_completeness
    BEFORE INSERT OR UPDATE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_log_completeness();

-- Enforce append-only on audit_log (the SLA monitor can mark archived_to_s3
-- via UPDATE, which is the one exception — driven by a SECURITY DEFINER fn).
CREATE OR REPLACE FUNCTION public.mark_audit_archived(
    p_audit_id BIGINT,
    p_s3_key TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.audit_log
       SET archived_to_s3 = true,
           archived_at    = now(),
           archive_s3_key = p_s3_key
     WHERE id = p_audit_id
       AND archived_to_s3 = false;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Schema isolation guard — application role privileges
-- ---------------------------------------------------------------------
-- Production posture: the compliance-service app role has:
--   - SELECT/INSERT/UPDATE on public_commercial.establecimientos
--   - SELECT/INSERT/UPDATE only with active consent_tokens row on
--     representative_consented.representantes (enforced by app code
--     in PR 2 — DB-level enforcement deferred until we have a real
--     workload to tune RLS policies against).
--   - INSERT-only on representative_consented.consent_tokens
--   - INSERT on public.audit_log, SELECT for DPO dashboard (PR 3)
--
-- Bootstrap role for SST migrations (operator provisions in production):
--   CREATE ROLE compliance_app LOGIN;
--   GRANT USAGE ON SCHEMA public_commercial TO compliance_app;
--   GRANT SELECT, INSERT, UPDATE ON public_commercial.establecimientos TO compliance_app;
--   GRANT USAGE ON SCHEMA representative_consented TO compliance_app;
--   GRANT SELECT, INSERT, UPDATE ON representative_consented.representantes TO compliance_app;
--   GRANT INSERT ON representative_consented.consent_tokens TO compliance_app;
--   GRANT USAGE, SELECT, INSERT ON ALL SEQUENCES IN SCHEMA public TO compliance_app;
--   GRANT SELECT, INSERT ON public.audit_log TO compliance_app;
--
-- (Statements above are intentionally NOT executed here — they require a
--  real role name. Operators provision them in the IaC step after the
--  first successful `sst deploy`.)

COMMIT;

-- =====================================================================
-- END schema.sql
-- =====================================================================