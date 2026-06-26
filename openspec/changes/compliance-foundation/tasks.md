# Tasks: Compliance Foundation (Habeas Data — Ley 1581/2012)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,800-2,200 (greenfield scaffold) |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Delivery strategy | ask-on-risk → **resolved: feature-branch-chain** |
| Chain strategy | **feature-branch-chain** (operator confirmed) |

Decision needed before apply: No (operator decided feature-branch-chain)
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Tracker Branch

`feature/compliance-foundation` is the integration branch. Each PR targets the prior PR's branch. Only the tracker merges to `main` after all PRs accepted.

### Suggested Work Units (feature-branch-chain)

| PR | Goal | Base branch (must be exact) |
|----|------|----------------------------|
| PR 1 | Monorepo scaffold + SST config + Postgres schema | **`feature/compliance-foundation`** (tracker) |
| PR 2 | Compliance Service Lambda (rights + audit + Verifik) | **PR 1 branch** (e.g., `feat/cf-pr1-monorepo-scaffold`) |
| PR 3 | Frontend legal pages + DPO dashboard | **PR 2 branch** |
| PR 4 | SLA monitor + cron + observability | **PR 3 branch** |
| PR 5 | RNBD submission prep + go-live runbook | **PR 4 branch** |

If any child PR diff shows prior PR changes, base is wrong — retarget before review.

## Phase 1: Foundation (PR 1)

- [ ] 1.1 Initialize monorepo with npm workspaces (`packages/*`, `apps/*`)
- [ ] 1.2 SST v4 config with Postgres + S3 buckets for cold archive
- [ ] 1.3 Create `packages/compliance-service/` with package.json + tsconfig
- [ ] 1.4 Write `packages/compliance-service/src/db/schema.sql` (2 schemas + audit_log + consent_tokens tables)
- [ ] 1.5 Configure CI/CD (GitHub Actions parallel with sibling repos)
- [ ] 1.6 Add `.github/workflows/legal-review.yml` (DPO + legal counsel required)
- [ ] 1.7 Run schema in dev Postgres, verify with `psql` smoke test

## Phase 2: Compliance Service Lambda (PR 2)

- [ ] 2.1 Implement `nit-dv.ts` (Verifik API wrapper + 24h cache in DynamoDB)
- [ ] 2.2 Implement `rights.ts` (4 endpoints: know/update/rectify/suppress)
- [ ] 2.3 Implement `audit.ts` (writes with: timestamp, verifier response, action, DPO sign-off)
- [ ] 2.4 Enforce schema isolation: queries against `public_commercial` cannot read `representative_consented`
- [ ] 2.5 Unit tests: schema isolation, consent token validation, SLA business-day math
- [ ] 2.6 Integration tests: Verifik sandbox + local Postgres via testcontainers

## Phase 3: Frontend (PR 3)

- [ ] 3.1 Create `apps/market-web/` Astro 6 app deployed to `market.opitacode.com`
- [ ] 3.2 Write PTD markdown source at `src/content/legal/ptd.md` (Spanish, DPO-editable)
- [ ] 3.3 Write Aviso de Privacidad markdown at `src/content/legal/aviso.md`
- [ ] 3.4 Render PTD + Aviso at `/legal/ptd` and `/legal/aviso`
- [ ] 3.5 Modify `Footer.astro` to include PTD + Aviso links on every page
- [ ] 3.6 Create `/admin/dpo/` route, auth-protected via opita-account-ui
- [ ] 3.7 DPO dashboard: audit log viewer, complaint queue, RNBD window alert

## Phase 4: SLA + Observability (PR 4)

- [ ] 4.1 Implement `sla-monitor.ts` (daily cron via SST Schedule, alerts > 15 business days)
- [ ] 4.2 Implement `dpo-tools/rnbd-window.ts` (alerts 2 Jan - 31 Mar)
- [ ] 4.3 Implement `dpo-tools/complaint-report.ts` (auto-draft H1 by 24 Aug, H2 by 24 Feb)
- [ ] 4.4 CloudWatch alarms + SES notifications to DPO email
- [ ] 4.5 E2E tests via Playwright (PTD reachable from every page, DPO dashboard auth-gated)
- [ ] 4.6 S3 cold archive lifecycle policy (5y retention)

## Phase 5: Go-Live (PR 5)

- [ ] 5.1 Verify RNBD portal access with SIC (operator action)
- [ ] 5.2 Submit RNBD registration for Opita Market database (operator + DPO)
- [ ] 5.3 Store RNBD receipt as immutable audit artifact (S3 with object lock)
- [ ] 5.4 Schedule production deploy (manual gate, DPO sign-off required)
- [ ] 5.5 Post-deploy smoke test: rights workflow in prod with synthetic NIT
- [ ] 5.6 Update README + ops runbook for go-live + ongoing compliance ops

## Implementation Order

PRs are sequential (each depends on prior). PR 1 unblocks all others. PR 5 is the only one with operator-action items (5.1, 5.2, 5.4).

## Open Questions (resolved at apply time)

- DPO candidate identification (resolve Week 1, block PR 5.4)
- Verifik API pricing quote (resolve Week 1, block PR 2.1)
- S3 cold storage class (resolve Week 4, block PR 4.6)
