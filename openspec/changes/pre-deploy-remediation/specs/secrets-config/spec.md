# Spec: secrets-config

## Purpose

Wompi production keys, JWT secrets, and other credentials are currently in plaintext `.env` files, with PUBLIC_ prefix exposing them to client bundles, and without centralized rotation. This spec mandates all secrets via SST Secrets, all env vars typed, and explicit rotation procedures.

## Requirements

### R1 — All production secrets in SST Secrets
- `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_SECRET`, `WOMPI_INTEGRITY_SECRET`
- `JWT_SECRET` (shared with opita-account-ui)
- `VERIFIK_API_KEY` (already in SST)
- `COMPLIANCE_JWT_SECRET` (already in SST)
- No production secret in `.env` files (only `WOMPI_PUBLIC_KEY` in `.env.local` for build-time widget init)

### R2 — No PUBLIC_ prefix on secrets
- Frontend env vars MUST NOT use `PUBLIC_` prefix for any secret
- `PUBLIC_*` vars are inlined into client bundle (Vite/Astro behavior)
- Secrets MUST be read at runtime via `globalThis.env` (Cloudflare Pages) or runtime injection

### R3 — Typed env vars
- Use `zod` or `envalid` schema to parse all env vars at boot
- Missing required var → fail fast at startup
- Invalid format → fail fast with clear error

### R4 — Rotation procedure documented
- Wompi keys: manual rotation in Wompi dashboard, then update SST Secret, then deploy
- JWT secret: zero-downtime rotation (new + old valid for 24h)
- Verifik: API key rotation via Verifik dashboard
- Documented in `RUNBOOK.md` with step-by-step + verification

### R5 — No secrets in git history
- `.env`, `.env.local`, `.env.production` MUST be in `.gitignore`
- `legal-secrets.generated.ts` MUST be gitignored (regenerated at build)
- `dist/`, `build/`, `.sst/` MUST be gitignored

### R6 — IAM least-privilege for Lambda
- Each Lambda role gets ONLY the DynamoDB tables it needs
- No `*` on Secrets Manager
- No `*` on S3 (specific bucket ARNs only)
- Log group restricted to specific log group ARN
- Verified via `aws iam get-role-policy` post-deploy

## Scenarios

### S1 — Rotating Wompi private key
- Operator logs into Wompi dashboard, generates new key
- Updates `WOMPI_PRIVATE_KEY` SST Secret: `npx sst secret set WOMPI_PRIVATE_KEY`
- Deploys Lambda: `npx sst deploy --stage prod`
- Lambda now uses new key
- Old key can be revoked in Wompi dashboard
- **Closes**: OPL-IAM-003, OPL-SECRET-001

### S2 — Frontend bundle inspection
- Build market-web: `npm run build`
- `grep -r 'JWT_SECRET' apps/market-web/dist/` returns no matches
- `grep -r 'PUBLIC_JWT' apps/market-web/dist/` returns no matches
- **Closes**: MW-FE-001

### S3 — Missing required env var
- Deploy without `WOMPI_INTEGRITY_SECRET`
- Lambda fails to start with: `Required env var WOMPI_INTEGRITY_SECRET is missing`
- Stack trace shows clear remediation
- **Closes**: operational reliability

### S4 — Lambda IAM audit
- `aws iam get-role-policy --role-name PagosApi-LambdaExecutionRole-XXX`
- Policy shows specific table ARNs, no wildcards
- Secrets Manager access only for the 4 Wompi secrets
- **Closes**: OPL-IAM-001

## Out of Scope

- HashiCorp Vault (using AWS Secrets Manager only)
- Per-request credential rotation (overkill for our scale)
- Encrypted env vars at rest (SST Secrets already do this)
