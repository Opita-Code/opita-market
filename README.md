# Opita Market

Multi-vertical Colombian marketplace — real-time price dashboard + directory + comparator for ALL economic sectors. B2B + B2C. AI-2026-first.

🌐 **Production**: `market.opitacode.com`
🏢 **Org**: `Opita-Code`

## Status

🟢 **Phase 0 closed** (all critical decisions made — see [`openspec/config.yaml`](openspec/config.yaml))
🟡 **Phase 1 SDD active** (compliance-foundation change in design — PR 1 of 5 in flight)

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

Full specs: `openspec/changes/compliance-foundation/specs/{data-protection-compliance,data-segregation-model,titular-rights-workflows}/spec.md`.

## Repository layout (monorepo)

```
opita-market/
├── packages/
│   └── compliance-service/        # Lambda package (PR 2 adds handlers; PR 1 ships schema only)
│       ├── src/
│       │   ├── db/schema.sql      # Two segregated schemas + audit_log + consent_tokens
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── apps/                          # Astro frontend (added in PR 3)
├── sst.config.ts                  # SST v3 — Aurora + AuditArchive bucket + NitDvArchive bucket
├── .github/workflows/
│   ├── ci.yml                     # typecheck + lint + test on every PR
│   └── legal-review.yml           # DPO + legal counsel required for legal text changes
└── openspec/                      # SDD artifacts
    ├── config.yaml
    └── changes/compliance-foundation/
        ├── proposal.md
        ├── specs/{data-protection-compliance,data-segregation-model,titular-rights-workflows}/spec.md
        ├── design.md
        └── tasks.md
```

## SDD Status

See [`openspec/changes/`](openspec/changes/) for active changes.

Current active change: **compliance-foundation** (Ley 1581/2012 Habeas Data gate)
- Proposal: `openspec/changes/compliance-foundation/proposal.md`
- Specs: `openspec/changes/compliance-foundation/specs/{data-protection-compliance,data-segregation-model,titular-rights-workflows}/spec.md`
- Design: `openspec/changes/compliance-foundation/design.md`
- Tasks: `openspec/changes/compliance-foundation/tasks.md`

Future changes (planned):
- **marketplace-catalog-mvp** — Astro frontend + auth + synthetic listings
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
npm test             # vitest (no tests yet — added per-package in PR 2+)
```

### SST dev mode (PR 2+ — handlers required)

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

- `.atl/skill-registry.md` — available skills for subagents
- Memory bus: dark-mem (cross-session persistent context)
- OpenSpec: `openspec/` (file-based artifacts)

## License

MIT (TBD — pending decision)