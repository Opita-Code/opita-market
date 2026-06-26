# Design: Compliance Foundation (Habeas Data — Ley 1581/2012)

## Technical Approach

Compliance enforced by **schema segregation + consent tokens + audit log + DPO tooling**. NIT+DV verification via Verifik API (third-party RUES wrapper). Audit log in Postgres with 5-year retention + S3 cold archive. PTD + Aviso as versioned markdown in repo, Astro-rendered at `market.opitacode.com/legal/`. DPO tooling = internal admin dashboard backed by Postgres + dark-mem audit log.

Maps to specs: `data-protection-compliance` (RNBD + PTD + DPO), `data-segregation-model` (2 schemas + consent), `titular-rights-workflows` (4 rights + audit + SLA).

## Architecture Decisions

### Decision: NIT+DV verification service

**Choice**: Verifik API (third-party wrapper for RUES + DIAN)
**Alternatives**: Direct RUES scraping, Apitude, Croma, internal-only
**Rationale**: Verifik has best uptime + cleanest API for Colombia. Direct RUES scraping violates Ley 1273/2009 (unauthorized access). Verifik ~$0.05/lookup. Cached 24h to reduce calls.

### Decision: Schema segregation approach

**Choice**: Two Postgres schemas (`public_commercial`, `representative_consented`)
**Alternatives**: Row-level security (RLS), single schema with `is_consented` flag, DynamoDB separate tables
**Rationale**: Two schemas = hard physical boundary, easier audit, simpler queries. RLS adds runtime overhead and edge cases. Single schema with flag risks accidental leakage in queries. DynamoDB separate tables works but no SQL joins across.

### Decision: Audit log storage

**Choice**: Postgres `audit_log` table + S3 cold archive at 5-year mark
**Alternatives**: DynamoDB only, S3 only, external SIEM (Splunk/Datadog)
**Rationale**: Postgres enables SQL queries for DPO reports + semiannual SIC complaints report. S3 cold archive satisfies 5-year retention cheaply. External SIEM is overkill at MVP scale.

### Decision: PTD publication

**Choice**: Static markdown files in repo, Astro-rendered
**Alternatives**: CMS-managed (Strapi/Contentful), DPO-editable web form
**Rationale**: Legal text benefits from version control + PR review (DPO + legal counsel as reviewers). Astro already in stack from `sociedad-opita-app` pattern. CMS adds operational burden + security surface.

### Decision: DPO tooling

**Choice**: Internal Astro admin dashboard (`/admin/dpo/`) backed by Postgres + dark-mem log
**Alternatives**: External SaaS (OneTrust, TrustArc), Google Sheets + Zapier
**Rationale**: Internal is cheaper + fully auditable + under our control. External SaaS adds $$ + data residency concerns (Habeas Data). Sheets is fragile for legal compliance.

## Data Flow

```
Titular submits rights request (form or admin tool)
        ↓
NIT+DV verification → Verifik API → cached 24h
        ↓ verified
Rights workflow handler (Lambda) → writes to respective schema
        ↓
Audit log entry (Postgres) with: ts, nit+dv response, action, DPO sign-off
        ↓
SES notification to DPO + response to titular (15-day SLA tracked)
        ↓
SLA monitor (cron daily) → alert if any request > 15 business days
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/compliance-service/` | Create | Lambda package for rights workflows + audit |
| `packages/compliance-service/src/api/rights.ts` | Create | 4 rights endpoints (know/update/rectify/suppress) |
| `packages/compliance-service/src/api/audit.ts` | Create | Audit log writes |
| `packages/compliance-service/src/api/nit-dv.ts` | Create | Verifik wrapper + 24h cache |
| `packages/compliance-service/src/db/schema.sql` | Create | 2 schemas + audit_log + consent_tokens tables |
| `packages/compliance-service/src/lib/sla-monitor.ts` | Create | Daily cron to detect SLA breaches |
| `packages/compliance-service/src/lib/dpo-tools/` | Create | Annual RNBD window check, H1/H2 complaint report builder |
| `apps/market-web/src/pages/legal/ptd.astro` | Create | PTD static page (Spanish) |
| `apps/market-web/src/pages/legal/aviso.astro` | Create | Aviso de Privacidad static page (Spanish) |
| `apps/market-web/src/components/Footer.astro` | Modify | Add PTD + Aviso links (every page) |
| `apps/market-web/src/pages/admin/dpo/index.astro` | Create | DPO dashboard (audit log, complaints, alerts) |
| `apps/market-web/src/content/legal/ptd.md` | Create | PTD markdown source (DPO-editable) |
| `apps/market-web/src/content/legal/aviso.md` | Create | Aviso markdown source |
| `sst.config.ts` | Modify | Add ComplianceAPI Lambda + daily SLA cron |
| `.github/workflows/legal-review.yml` | Create | PR review gate: DPO + legal counsel required for `content/legal/*` |
| `README.md` | Modify | Document compliance architecture |

## Interfaces / Contracts

```typescript
// Rights workflow endpoint
POST /api/rights/{know|update|rectify|suppress}
Body: { nit: string, dv: string, request_type: string, payload?: any }
Response: { request_id: string, status: "received", sla_deadline: ISO8601, audit_id: string }

// NIT+DV verification (cached 24h)
GET /api/verify-nit/:nit/:dv
Response: { verified: boolean, razon_social?: string, expires_at: ISO8601 }

// Audit log query (DPO only, authenticated)
GET /api/audit?from=&to=&action=
Response: { rows: AuditEntry[], total: number, next_cursor?: string }
```

## Testing Strategy

| Layer | What to Test | How |
|-------|-------------|-----|
| Unit | Schema isolation, consent token validation, SLA math | vitest + testcontainers Postgres |
| Integration | Verifik mock, rights workflows E2E, audit log completeness | LocalStack + Verifik sandbox |
| E2E | PTD page reachable from any page, DPO dashboard auth-gated | playwright against dev env |

## Migration / Rollout

No data migration (greenfield). Phased:
- **W1**: Schema deployed to dev (no production data)
- **W2**: NIT+DV verification live in dev with Verifik sandbox
- **W3**: PTD + Aviso live at `market.opitacode.com/legal/`
- **W4**: DPO dashboard live in dev
- **W5**: Full E2E in staging (Playwright matrix)
- **W6**: RNBD submission + production go-live (data ingestion unlocked)

## Open Questions

- DPO candidate identification — need 2-3 candidates in Week 1 (legal counsel network)
- Verifik API binding pricing — estimate $0.05/lookup, need signed quote
- Self-service rights-request UI vs admin-only — admin-only for MVP per proposal assumption, defer to Change 2
- Cold archive format (S3 Glacier vs Glacier Deep Archive vs standard S3 IA) — decide Week 4
