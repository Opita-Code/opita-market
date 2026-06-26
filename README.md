# Opita Market

Multi-vertical Colombian marketplace — real-time price dashboard + directory + comparator for ALL economic sectors. B2B + B2C. AI-2026-first.

🌐 **Production**: `market.opitacode.com`
🏢 **Org**: `Opita-Code`

## Status

🟢 **Phase 0 closed** (all critical decisions made — see [`openspec/config.yaml`](openspec/config.yaml))
🟡 **Phase 1 SDD active** (compliance-foundation change in design)

## Architecture

- **Frontend**: Astro 6 SSR at `market.opitacode.com`
- **Auth**: Reuses `opita-account-ui` (Cognito at `cuenta.opitacode.com`)
- **API**: `api.opitacode.com/market/*` (SST Router, shared with sibling products)
- **DB**: Postgres + pgvector (planned), DynamoDB single-table (org pattern)
- **AI**: MiniMax Token Plan Max ($50/mo, full multimodal — language, speech, video, image, music)
- **Ingestion**: Firecrawl + Browser Use + Skyvern + RUES/DIAN/datos.gov.co + Google Places + OSM (carta blanca)
- **Payments**: Wompi (B2B only, B2C sees ads)
- **Compliance**: Habeas Data Ley 1581/2012 — DPO + RNBD + PTD + derecho al olvido

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

## Documentation

- `.atl/skill-registry.md` — available skills for subagents
- Memory bus: dark-mem (cross-session persistent context)
- OpenSpec: `openspec/` (file-based artifacts)

## License

MIT (TBD — pending decision)
