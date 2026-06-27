# SESSION STATE — opita-market pre-deploy remediation (2026-06-27)

> **Self-load context after compact**: read this file FIRST before re-reading
> any source. It has the verified state, pending work, and conventions to
> avoid wasting context.

## TL;DR

- **8 PRs merged (1-8)** in `feat/cf-pr5-go-live` branch
- **84/100 pentest findings closed** (verified by `scripts/verify-pentest-closure.py`)
- **0 production-blockers open** (last one — OPL-API-007 — closed in PR 8)
- **Dev deployed and live** (PR 7 + PR 8)
- **679/679 tests pass** across the monorepo
- **Remaining**: code work (5h) + operator actions (Wompi keys, SRI, DPO URL) + external (SIC, auditor)

## Branch & PRs

- **Working branch**: `feat/cf-pr5-go-live` (35 commits ahead of main)
- **GitHub PR #1** (PR 7: Transactional Closure) — OPEN
- Last 3 commits on this branch:
  - `1b14864` fix(pagos): PR 8 - Body size limit middleware (closes OPL-API-007)
  - `1569f59` docs(pentest): add post_remediation_status to FINDINGS.json (PR 1-7 closure)
  - `917f41d` feat(pagos+frontend): PR 7 - Transactional Closure (refund + hold + structuring + device fp)

## Dev Environment (LIVE)

- **PagosAPI**: https://hlbu3fa524q5fblfceo55hw2uq0tuozy.lambda-url.us-east-1.on.aws/
- **ComplianceAPI**: https://udjlkxefparhei7d52f4eb6tfa0ziell.lambda-url.us-east-1.on.aws/
- **SST stack**: opita-market / stage: dev / region: us-east-1 / account: 728741135483
- **Health check**: `GET /health` → `{"status":"ok"}`
- **Wompi keys**: ALL sandbox (operator mid-rotation, restored to sandbox for dev consistency)

## Pentest Status (verified by code search)

| Severity | Closed | Open | Total |
|---|---|---|---|
| CRITICAL | 18 | 0 | 18 |
| HIGH | 24 | 2 | 26 |
| MEDIUM | 23 | 1 | 24 |
| LOW | 18 | 2 | 20 |
| INFO | 1 | 1 | 2 |
| **Total** | **84 (84%)** | **6** | 90 verified |

**10 doc/UX/process items** (not code, deferred to pre-deploy checklist).

### 6 Code Gaps Remaining (no production-blockers)

| ID | Sev | What | Time |
|---|---|---|---|
| OPL-COMP-001 | HIGH | PTD missing DPO phone (doc) | 30 min |
| OPL-COMP-020 | HIGH | Wompi fees not displayed (UX) | 2h |
| MW-FE-012 | MEDIUM | JWT_SECRET at import time (should use globalThis.env) | 1h |
| OPL-API-012 | LOW | Webhook IP allowlist (Wompi IPs) | 1h |
| OPL-CARD-020 | LOW | COP reconciliation cron (tests exist, impl doesn't) | 2h |
| OPL-API-015 | INFO | Handle more Wompi webhook events (voided, error) | 1h |

## Operator Pre-Deploy Checklist (BEFORE prod with real money)

- [ ] **Wompi prod keys rotation** — all 4 from same prod env (public, private, events, integrity)
- [ ] **Wompi SRI official hash** — replace placeholder in `apps/market-web/src/lib/wompi-sri.ts:11`
- [ ] **PUBLIC_DPO_CONTACT_URL** — set in `apps/market-web/wrangler.toml` or Cloudflare dashboard
- [ ] **OPL-COMP-001** — assign DPO phone + update PTD §1
- [ ] **OPL-COMP-020** — display Wompi commission at checkout
- [ ] **SIC registration kick-off** for closed-loop wallet (Decreto 222/2020) — takes weeks
- [ ] **External auditor RFP** — Cure53 ($10-20K) or Trail of Bits ($20-50K)
- [ ] **ComplyAdvantage signup** — swap `MockComplianceScreeningProvider` → real (when $$$)
- [ ] Promote to staging → prod cutover (after auditor sign-off)

## Key Files (DO NOT re-read unless needed)

| File | Why | Status |
|---|---|---|
| `scripts/verify-pentest-closure.py` | Source of truth for status reports | RE-RUNNABLE |
| `openspec/changes/opita-pagos-foundation/FINDINGS.json` | Updated with `post_remediation_status` section | COMMITTED (1569f59) |
| `packages/pagos-service/src/lib/wompi.ts` | WompiClient (signTransaction, verifyWebhook, getTransaction, refundTransaction) | DONE |
| `packages/pagos-service/src/lib/webhook-gateway/gateway.ts` | processWompiWebhook (state machine, 3DS, idempotency) | DONE |
| `packages/pagos-service/src/lib/transact/wallet.ts` | transactP2PTransfer (atomic) | DONE |
| `packages/pagos-service/src/lib/transact/bonus.ts` | transactReverseBonus (closes OPL-CARD-014) | DONE |
| `packages/pagos-service/src/lib/withdrawal-cooling-off.ts` | getOldestUnreleasedDeposit + canWithdraw (Decreto 222) | DONE |
| `packages/pagos-service/src/lib/structuring.ts` | detectStructuring ($200k boundary) | DONE |
| `packages/pagos-service/src/lib/body-size-limit.ts` | bodySizeLimit middleware (closes OPL-API-007) | DONE |
| `apps/market-web/src/lib/device-fingerprint.ts` | FingerprintJS open-source integration | DONE |
| `sst.config.ts` | BonusesTable.TransactionIdIndex GSI added | DEPLOYED |
| `vitest.workspace.ts` (root) | Picks up per-package configs (fixes 22 React tests) | DONE |
| `RUNBOOK.md` | Production operations + DPO handoff | EXISTS |

## Conventions / Lessons Learned

1. **Verify code claims, not PR descriptions** — use `scripts/verify-pentest-closure.py` as ground truth
2. **Test fixtures for vitest**: `tests/unit/X.test.ts` uses `../../src/...` (2 levels); `tests/unit/api/X.test.ts` uses `../../../src/...` (3 levels)
3. **Wompi keys**: all 4 MUST be from same env (sandbox or prod). Mixing breaks signature verification.
4. **JWT_SECRET env var**: in dev only `process.env.JWT_SECRET` works (Vite injects at build time); in prod use `globalThis.env.JWT_SECRET` (Cloudflare runtime). MW-FE-012 is the gap.
5. **Vite mock for ESM default export**: `vi.mock("@mod", () => ({ default: { ... } }))` — must provide `default` key.
6. **dark-mem audit trail**: every PR 1-8 has its own obs-* entry. Run `mem_search topic_key:sprint/pre-deploy-remediation/pr-7` to see PR 7 history.

## Pending Next Steps (in priority order)

1. **Promote to staging** (operator action: merge PR #1 to main → `sst deploy --stage staging`)
2. **PR #2** (PR 8 — body size limit) — needs to be opened on GitHub (or merged as part of PR #1)
3. **5 remaining code gaps** — 5-7h total work
4. **External auditor** (long-pole)
5. **SIC registration** (long-pole, weeks)

## Avoid These Anti-Patterns (learned the hard way)

- ❌ Don't claim "X is closed" based on PR commit message — run `verify-pentest-closure.py`
- ❌ Don't write the same comment style as PR description ("closes OPL-FOO") in multiple places — one canonical claim in FINDINGS.json
- ❌ Don't add helpers without a caller in the same PR (PR 5's canWithdraw was dead code for 2 weeks)
- ❌ Don't use `vi.mock` with named exports only — must provide `default` for ESM
- ❌ Don't assume Path(`__file__`).parents[2] for repo root — usually parents[1] is enough

## Session Dark-Mem Trail (key obs-* IDs)

- obs-15cf9a7283b9 — premature "lito" claim lesson
- obs-ef27d4b2d33d — PR 7 corrected scope
- obs-c63af1069a65 — PR 7.1 OPL-CARD-014 closed
- obs-d2228fda6d12 — PR 7.2 OPL-CARD-008 closed
- obs-85d4d86c563f — PR 7.3 OPL-CARD-016 closed
- obs-14774d525800 — PR 7.4 OPL-CARD-013 + jsdom fix
- obs-34b10518b8b4 — PR 7 merged
- obs-8aa49bb01688 — pentest verification 83/100 closed
- obs-d1cc17ccb5b6 — FINDINGS.json updated
- obs-26465bcd6ff5 — Dev re-deploy successful
- obs-eb236a84799c — PR 8 OPL-API-007 closed
- obs-X — **THIS SESSION STATE** (next entry)

## Operator Language

- Operator communicates in **Spanish** (informal, terse)
- Prefers **"A / B / C" options** with my vote
- Wants **honest status** — don't oversell
- Trust established after the "lito" misclaim → verify, don't trust PR claims
- Operator uses `1` to mean "option 1" (e.g., "1" for "commit + push + open PR 7")
