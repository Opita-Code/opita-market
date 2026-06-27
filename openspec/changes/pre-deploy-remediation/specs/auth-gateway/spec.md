# Spec: auth-gateway

## Purpose

Centralize authentication and authorization into a single reusable gateway. Today each endpoint does its own auth check, with at least 3 different patterns (x-dev-user, Cognito, opita_id_token) and 2 fail-open conditions. This spec introduces one entry point that all endpoints must use.

## Requirements

### R1 — Mandatory JWT verification
Every protected request MUST go through `authGateway(ctx)` which:
- Verifies JWT signature (HS256) with the shared secret
- Validates `aud` claim = `market.opitacode.com`
- Validates `iss` claim = `cuenta.opitacode.com`
- Validates `exp` claim (not expired)
- Throws `AuthError` with code `INVALID_AUDIENCE` / `INVALID_ISSUER` / `EXPIRED_TOKEN` on failure
- Returns `AuthContext` with `{ userId, email, groups, deviceId, ip }` on success

### R2 — Role-based access control (RBAC)
- `requireRole(ctx, role)` MUST throw `AuthError('FORBIDDEN')` if user does not have the required role
- Roles: `user` (default), `merchant`, `dpo`, `admin`
- Multiple roles allowed (user can be both `user` and `merchant`)

### R3 — Dev-bypass via explicit flag
- `x-dev-user` header accepted ONLY when `process.env.DEV_AUTH_ENABLED === 'true'`
- NOT based on `NODE_ENV !== 'production'` (Lambda default has NODE_ENV=undefined)
- Default: `DEV_AUTH_ENABLED` is unset → dev-bypass disabled
- Production deployment MUST verify `DEV_AUTH_ENABLED` is not set to `'true'`

### R4 — IP allowlist for webhooks
- Wompi webhook: `c.req.header('x-forwarded-for')` MUST be in Wompi's documented IP ranges
- Transportadora webhook: IP MUST be in per-transportadora allowlist from `logistics` table
- Allowlist check happens in `webhookGateway` (not `authGateway`)

### R5 — Per-role rate limit
- `user` role: 60 requests/minute per userId
- `merchant`: 300 requests/minute per userId
- `dpo`: 600 requests/minute per userId
- Anonymous (unauthenticated): 20 requests/minute per IP
- Exceeded → 429 with `Retry-After` header
- Implementation: Redis counter (already in stack)

### R6 — No error message info leak
- All auth errors MUST return generic `401` or `403` with `error_code: 'UNAUTHENTICATED' | 'FORBIDDEN'`
- No internal info in error message (no JWT claims, no role names)

## Scenarios

### S1 — Production with NODE_ENV undefined
- Lambda deployed with `NODE_ENV` unset
- Request with `x-dev-user: dpo@opita.co` header
- **Expected**: 401, dev-bypass NOT activated (because `DEV_AUTH_ENABLED !== 'true'`)
- **Closes**: OPL-LIB-005, MW-FE-003

### S2 — JWT with wrong audience
- Request with valid signature but `aud: 'admin.opitacode.com'`
- **Expected**: 401 with `error_code: 'INVALID_AUDIENCE'`
- **Closes**: MW-FE-006

### S3 — DPO endpoint without dpo role
- Request with user JWT (no `dpo` in groups)
- Endpoint requires `dpo` role
- **Expected**: 403 with `error_code: 'FORBIDDEN'`
- **Closes**: OPL-API-003, OPL-API-005 (IDOR)

### S4 — Rate limit exceeded
- 61st request from same userId in 60s
- **Expected**: 429 with `Retry-After: 60` header
- **Closes**: OPL-API-006 (partial)

### S5 — Anonymous rate limit
- 21st request from same IP without auth
- **Expected**: 429
- **Closes**: OPL-API-006 (partial)

## Out of Scope

- Cognito JWT minting (handled by opita-account-ui)
- Session management (cookie-based, handled by frontend)
- API key auth (no API key pattern in current product)
- OAuth flow (out of scope — uses Cognito hosted UI)
