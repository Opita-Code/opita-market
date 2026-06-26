# Proposal: Compliance Foundation (Habeas Data — Ley 1581/2012)

## Intent

Opita Market is a greenfield Colombian multi-vertical marketplace. Any data collection — business listings, user accounts, claims, reviews — triggers Habeas Data obligations under Ley 1581/2012 + Decreto 1377/2013 + SIC Circular Única. SIC reported **101 sanciones in 2025** with multas up to **2,000 SMLMV (~$700M COP)**. Without this foundation in place before user data flows, the platform cannot legally operate.

## Scope

### In Scope
- Contract Data Protection Officer (DPO) — virtual/part-time, ~$2-5M COP/mes
- Draft + publish Aviso de Privacidad + Política de Tratamiento de Datos (PTD) in Spanish on `market.opitacode.com`
- Register Opita Market's database in SIC's **Registro Nacional de Bases de Datos (RNBD)**
- Build "Suprimir mi negocio" user flow backed by NIT+DV verification
- Implement three titular-rights workflows: conocer, actualizar, rectificar, suprimir
- Data model split: `datos_publicos_establecimiento` vs `datos_personales_representante`

### Out of Scope
- DPO for sister products (cuenta.opitacode.com, vibe.opitacode.com) — those have separate compliance
- Full legal review of international data transfers (only relevant if LATAM expansion launches)
- Cookie consent banner UX (deferred to Change 2)
- Tenant-level PTD customization (deferred to Change 2 premium tier)

## Capabilities

### New Capabilities
- `data-protection-compliance`: Ley 1581/2012 compliance — DPO, RNBD registry, PTD publication
- `data-segregation-model`: physical schema separation of public-commercial data vs personal-representative data, with consent enforcement
- `titular-rights-workflows`: end-to-end flows for conocer / actualizar / rectificar / suprimir ("derecho al olvido"), with NIT+DV-backed identity verification

### Modified Capabilities
- None (greenfield project — no existing specs)

## Approach

1. **Week 1**: Engage Colombian data-protection legal counsel (e.g., ResGuard Solutions, Dentons Cardenas & Cardenas) to draft PTD + Aviso de Privacidad templates. Contract DPO (virtual, part-time).
2. **Week 1-2**: Build data segregation in schema design (Postgres). Public fields: razón_social, NIT, dirección registrada, horarios, categoría, fotos. Personal fields: email_rep, teléfono_rep, firma_rep — require explicit consent token.
3. **Week 2**: Implement titular-rights workflows as internal API endpoints (not user-facing UI yet — admin-only). Log every request to audit table with timestamp + NIT+DV verifier response.
4. **Week 2-3**: Register database in RNBD via SIC online portal. Submit before any production data ingestion begins. Calendar reminder: annual update 2 enero - 31 marzo.
5. **Week 3**: Publish PTD + Aviso de Privacidad on `market.opitacode.com/legal/{ptd,aviso}` (linked from footer of every page).

## Affected Areas

| Area | Impact | Description |
|------|--------|------------|
| `openspec/specs/data-protection-compliance/spec.md` | New | Compliance requirements |
| `openspec/specs/data-segregation-model/spec.md` | New | Schema separation rules |
| `openspec/specs/titular-rights-workflows/spec.md` | New | Rights workflows |
| `market.opitacode.com/legal/{ptd,aviso}` | New | Legal pages |
| SIC RNBD registry | External | Database registration |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DPO not available within 2 weeks | Medium | Engage 2-3 candidates in parallel; have backup legal counsel |
| RNBD registration delayed by SIC | Medium | Start registration Week 2 (parallel to schema work); flag as launch-blocker |
| Ley 1581 reform passes (2025 project) requiring mandatory DPO | Low | Already aligned — we hire DPO from day 1 |
| Personal data leaks before segregation enforced | Medium | Schema-first, contract-first; no production data ingested until both ready |

## Rollback Plan

- DPO contract: 30-day cancellation clause (standard)
- RNBD registration: cannot be "rolled back" but can be updated/suspended via SIC portal
- PTD publication: revert via CloudFront invalidation + git revert
- Schema changes: greenfield, no migration needed

## Dependencies

- DPO candidate identification (legal counsel network)
- SIC portal access (registered user)
- Colombian legal counsel engagement

## Success Criteria

- [ ] DPO contracted and onboarded (Week 3)
- [ ] PTD + Aviso de Privacidad published on `market.opitacode.com/legal/`
- [ ] RNBD registration submitted (acceptance pending OK)
- [ ] Schema segregation enforced in dev environment
- [ ] Titular-rights workflows tested end-to-end (admin-only)
- [ ] Audit log retention policy defined (≥5 years per SIC requirement)
- [ ] Zero personal-data columns in any production table without consent token

## Assumptions (to validate with operator)

1. **DPO is virtual/part-time** (~$2-5M COP/mes). In-house full-time DPO is overkill at MVP scale.
2. **PTD + Aviso are Spanish-only** for MVP. Multi-idioma deferred to Change 2 if international launch.
3. **No cookie consent banner yet** — added in Change 2 when first user-facing tracking appears.
4. **Titular-rights UI is admin-only** at MVP. Self-service portal deferred until user volume justifies it.
