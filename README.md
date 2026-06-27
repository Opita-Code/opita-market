# Opita Market

Multi-vertical Colombian marketplace — real-time price dashboard + directory + comparator for ALL economic sectors. B2B + B2C. AI-2026-first.

🌐 **Production**: `market.opitacode.com`
🏢 **Org**: `Opita-Code`

## Status

🟢 **Phase 0 closed** (all critical decisions made — see [`openspec/config.yaml`](openspec/config.yaml))
🟢 **Phase 1 SDD complete** — `compliance-foundation` change shipped (5 of 5 PRs in flight)
🔵 **Phase 2 SDD planned** — `marketplace-catalog-mvp` next (Opita Code as anchor tenant)

## Architecture

- **Frontend**: Astro 6 SSR at `market.opitacode.com` (PR 3)
- **Auth**: Reuses `opita-account-ui` (Cognito at `cuenta.opitacode.com`)
- **API**: `api.opitacode.com/market/*` (SST Router, shared with sibling products)
- **DB**: Aurora Postgres + S3 cold archive (PR 1) + DynamoDB single-table (org pattern)
- **AI**: MiniMax Token Plan Max ($50/mo, full multimodal — language, speech, video, image, music)
- **Ingestion**: Firecrawl + Browser Use + Skyvern + RUES/DIAN/datos.gov.co + Google Places + OSM (carta blanca)
- **Payments**: Wompi (B2B only, B2C sees ads)
- **Compliance**: Habeas Data Ley 1581/2012 — DPO + RNBD + PTD + derecho al olvido

## Compliance Foundation (Habeas Data — Ley 1581/2012)

This repo's first milestone is compliance-gated. No personal data flows into
the system until the schema segregation, consent tokens, audit log, and DPO
tooling are live.

Two physically isolated Postgres schemas (no row-level security, no flag
column — hard boundary):

| Schema                          | Holds                                        | Access model                          |
| ------------------------------- | -------------------------------------------- | ------------------------------------- |
| `public_commercial`             | `razon_social`, `nit`, `direccion_registrada`, `fotos`, `horarios_publicados` | permissive — already public via RUES/DIAN/Places |
| `representative_consented`      | `email_rep`, `telefono_rep`, `firma_rep`, `nombre_rep` | consent-gated via `consent_tokens`   |

Plus:

- `public.audit_log` — append-only, 5-year retention, ships to `AuditArchive`
  S3 bucket at the 5-year mark (per SIC requirement)
- `representative_consented.consent_tokens` — Ley 1581/2012 Art. 9 consent
  trail, append-only, hash-pinned to the PTD/Aviso version signed
- `RnbdReceipts` S3 bucket — Object Lock COMPLIANCE mode, 7-year retention
  for SIC-issued RNBD receipts (PR 5 task 5.3)

Full specs: `openspec/changes/compliance-foundation/specs/{data-protection-compliance,data-segregation-model,titular-rights-workflows}/spec.md`.

## Go-Live Checklist (PR 5)

The MVP cannot go live until ALL 10 steps in `scripts/deploy/production-checklist.sh`
show ✅ AND the DPO has signed off. **Do not skip any step.**

```bash
# 1. Run the mandatory pre-deploy gate (includes DPO sign-off capture).
bash scripts/deploy/production-checklist.sh

# 2. If the checklist exits 0, deploy.
npx sst deploy --stage prod

# 3. Run the prod smoke test (hits https://market.opitacode.com).
cd apps/market-web
PLAYWRIGHT_BASE_URL=https://market.opitacode.com \
  npx playwright test e2e/prod-smoke.spec.ts
```

For full operational procedures (DPO handoff, annual RNBD updates,
holiday list maintenance, incident response) see [RUNBOOK.md](RUNBOOK.md).

## DPO Handoff

The DPO is the accountable party for Ley 1581/2012 compliance. The Opita
Market stack enforces that:

- The DPO user exists in Cognito user pool `us-east-1_LItAcj2Aa` under
  the `dpo` group (without it, `/admin/dpo` returns 403).
- The DPO email (`PTD_DPO_EMAIL` SST Secret) receives all SLA breaches,
  RNBD window alerts, and complaint report drafts via the SES pipeline
  wired in `sst.config.ts`.

### Adding a new DPO user

```bash
# 1. Create the Cognito user (the operator's responsibility — IAM-gated).
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_LItAcj2Aa \
  --username <new-dpo-email> \
  --user-attributes Name=email,Value=<new-dpo-email> Name=email_verified,Value=true \
  --temporary-password <generated-strong-password>

# 2. Add them to the 'dpo' group (required for /admin/dpo access).
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_LItAcj2Aa \
  --username <new-dpo-email> \
  --group-name dpo

# 3. Update the PTD_DPO_EMAIL SST Secret (so alerts go to the new DPO).
sst secret set DpoEmail "<new-dpo-email>"

# 4. Update DPO_EMAILS env var (in SST config + AWS console) if the
#    cron emails should fan out to multiple recipients.
```

### Rotating the shared HMAC JWT_SECRET

`ComplianceJwtSecret` is shared between `opita-market` and `opita-account-ui`
(HS256, jose). To rotate without downtime:

```bash
# 1. Generate a new 32+ byte secret.
openssl rand -base64 48

# 2. In opita-account-ui, update JWT_SECRET to the new value and redeploy.
# 3. In opita-market, update the SST Secret and redeploy.
sst secret set ComplianceJwtSecret "<new-secret>"
npx sst deploy --stage prod
# 4. Coordinate: do BOTH deploys within a 15-minute window so old JWTs
#    issued by either side stay valid long enough for users in flight.
```

For the full DPO handoff procedure + what the new DPO needs to know on
day 1, see [RUNBOOK.md §"DPO Handoff"](RUNBOOK.md#dpo-handoff).

## Ongoing Compliance Ops

After go-live, the DPO is responsible for these recurring obligations:

| Cadence | Action | Tool |
| ------- | ------ | ---- |
| Annual (2 Jan – 31 Mar) | RNBD registration update (Ley 1581) | `bash scripts/rnbd/generate-form-payload.sh` + SIC portal + `scripts/rnbd/upload-receipt.sh` |
| Semiannual (24 Feb, 24 Aug) | Complaint report auto-draft review + SIC submission | CloudWatch → S3 → `s3://opita-market-prod-auditarchive/complaint-reports/` |
| Annual (December) | Colombian holidays list update for SLA math | `packages/compliance-service/src/lib/colombian-holidays.ts` |
| Daily (06:00 Colombia) | SLA monitor cron runs (15-business-day breach alerts) | CloudWatch + SES |
| On DPO change | Cognito user add + group add + secret rotation | See "DPO Handoff" above |

For detailed step-by-step procedures for each, see [RUNBOOK.md](RUNBOOK.md).

## Repository layout (monorepo)

```
opita-market/
├── packages/
│   └── compliance-service/        # Lambda package (handlers + crons + DPO tools)
│       ├── src/
│       │   ├── api/                # /rights/*, /verify-nit/*, /audit endpoints
│       │   ├── lib/                # sla-math, sla-monitor, ses-alerts, etc.
│       │   ├── lib/dpo-tools/      # rnbd-window, complaint-report
│       │   ├── db/schema.sql       # Two segregated schemas + audit_log + consent_tokens
│       │   └── tests/
│       └── package.json
├── apps/
│   └── market-web/                 # Astro 6 SSR storefront
│       ├── src/
│       │   ├── pages/              # /, /legal/{ptd,aviso}, /admin/dpo
│       │   ├── components/dpo/     # TanStack Table + Recharts dashboard
│       │   ├── content/legal/      # PTD + Aviso markdown (SST Secret placeholders)
│       │   ├── lib/                # cognito-sso-consumer, legal-secrets
│       │   └── middleware.ts
│       └── e2e/                    # Playwright (legal-pages, legal-secrets, prod-smoke)
├── scripts/
│   ├── setup-secrets.sh            # Populate 6 PTD/Aviso SST Secrets (PR 4.5)
│   ├── rnbd/                       # RNBD submission + receipt upload (PR 5)
│   └── deploy/                     # production-checklist.sh (PR 5)
├── sst.config.ts                   # SST v4 — Aurora + AuditArchive + RnbdReceipts + Astro
├── RUNBOOK.md                      # Operational runbook (PR 5)
├── .github/workflows/
│   ├── ci.yml                      # typecheck + lint + test on every PR
│   └── legal-review.yml            # DPO + legal counsel required for legal text changes
└── openspec/                       # SDD artifacts
    ├── config.yaml
    └── changes/compliance-foundation/
        ├── proposal.md
        ├── specs/{data-protection-compliance,data-segregation-model,titular-rights-workflows}/spec.md
        ├── design.md
        └── tasks.md
```

## SDD Status

See [`openspec/changes/`](openspec/changes/) for active changes.

**Completed change**: `compliance-foundation` (Ley 1581/2012 Habeas Data gate, 5 PRs shipped)
- Proposal: `openspec/changes/compliance-foundation/proposal.md`
- Specs: `openspec/changes/compliance-foundation/specs/{data-protection-compliance,data-segregation-model,titular-rights-workflows}/spec.md`
- Design: `openspec/changes/compliance-foundation/design.md`
- Tasks: `openspec/changes/compliance-foundation/tasks.md` (all 5 phases ✅)

Future changes (planned):
- **marketplace-catalog-mvp** — Astro frontend + auth + synthetic listings (anchor: Opita Code as first tenant)
- **ingestion-pipeline** — Real OSINT data (Firecrawl + RUES + DIAN + Places + OSM)

## Local development

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Docker (optional, for local Postgres smoke testing)
- AWS credentials configured for SST (`aws configure sso`)

### Install dependencies

```bash
npm install
```

This installs every workspace (`packages/*` + `apps/*`) via npm workspaces.

### Run the database schema locally

`psql` is not installed by default in this repo's dev container. The schema
is idempotent and can be applied against any Postgres ≥ 14 with the
`pgcrypto` and `citext` extensions available.

Option A — local Postgres via Docker (smoke tested in PR 1):

```bash
docker run -d --name opita-pg \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=opita_dev \
  -p 55432:5432 \
  postgres:16-alpine

# Wait ~3s for the cluster to come up.
sleep 5

# Apply the schema (idempotent — safe to re-run).
Get-Content packages/compliance-service/src/db/schema.sql -Raw \
  | docker exec -i opita-pg psql -U postgres -d opita_dev
```

Option B — `psql` if installed natively:

```bash
psql "postgresql://postgres:devpass@localhost:55432/opita_dev" \
  -f packages/compliance-service/src/db/schema.sql
```

Option C — `sst deploy` against AWS (production posture):

```bash
# SST runs schema.sql automatically via the migrations.filePath binding
# in sst.config.ts on every deploy.
npx sst deploy --stage dev
```

### Typecheck / lint / test

```bash
npm run typecheck    # tsc --noEmit across all workspaces
npm run lint         # eslint across all workspaces (scaffolded, no rules yet)
npm test             # vitest (unit tests across packages/compliance-service + apps/market-web)
```

### SST dev mode

```bash
npx sst dev
```

This live-reloads Lambda handlers in `packages/compliance-service/src/`
against the provisioned AWS resources.

## CI / CD

- **`.github/workflows/ci.yml`** — typecheck + lint + test on every push to
  `main`/`feature/**`/`feat/**` and on every PR.
- **`.github/workflows/legal-review.yml`** — gates PRs that touch
  `apps/**/src/content/legal/**`, `apps/**/src/pages/legal/**`, or
  `openspec/**`. Requires approval from BOTH the `dpo` team and the
  `legal-counsel` team. Team slugs are configurable via repo vars
  `REQUIRED_DPO` and `REQUIRED_LEGAL`.

## Documentation

- [RUNBOOK.md](RUNBOOK.md) — operational procedures (DPO handoff, annual RNBD, incident response)
- `.atl/skill-registry.md` — available skills for subagents
- Memory bus: dark-mem (cross-session persistent context)
- OpenSpec: `openspec/` (file-based artifacts)

## License

MIT (TBD — pending decision)