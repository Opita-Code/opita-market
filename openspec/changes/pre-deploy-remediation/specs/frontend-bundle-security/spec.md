# Spec: frontend-bundle-security

## Purpose

Frontend bundle leaks secrets (PUBLIC_JWT_SECRET), has no CSRF protection, no CSP, no SRI on third-party scripts. Any single XSS leads to full site takeover. This spec hardens the bundle to defense-in-depth.

## Requirements

### R1 — No secrets in client bundle
- `grep -r 'JWT_SECRET\|WOMPI_PRIVATE\|WOMPI_EVENTS\|WOMPI_INTEGRITY' apps/market-web/dist/` returns no matches
- Verified in CI build step
- All secrets read at runtime via `globalThis.env` or `Astro.locals.runtime.env`

### R2 — Subresource Integrity (SRI) on third-party scripts
- Wompi widget script: `script.integrity = 'sha384-' + WompiSRIHash`
- `script.crossOrigin = 'anonymous'`
- Wompi SRI hash obtained from Wompi support, stored as runtime env var

### R3 — CSRF protection
- Backend issues `__csrf` double-submit cookie on GET requests (SameSite=Strict, HttpOnly=false)
- Frontend reads cookie, sends as `X-CSRF-Token` header on all state-mutating requests
- Backend validates token matches cookie
- Reject request with 403 if missing/mismatched
- Cookie domain: `.opitacode.com` (works across subdomains)

### R4 — Content Security Policy (CSP)
- `default-src 'self'`
- `script-src 'self' https://checkout.wompi.co`
- `style-src 'self' 'unsafe-inline'` (Astro scoped styles)
- `frame-src https://checkout.wompi.co`
- `img-src 'self' data: https://*.amazonaws.com` (S3 evidence bucket)
- `connect-src 'self' https://*.opitacode.com`
- `report-uri /api/csp-report` (for monitoring violations)

### R5 — Security headers (in addition to CSP)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: payment=(self), geolocation=()`

### R6 — No generator meta tag
- Remove `<meta name="generator" content={Astro.generator} />` from BaseLayout
- No version disclosure in HTML

## Scenarios

### S1 — Bundle audit
- `npm run build` in market-web
- Run audit script: `grep -rE 'SECRET|PRIVATE|INTEGRITY|EVENTS' dist/ | grep -v node_modules`
- Returns empty (no secrets in bundle)
- **Closes**: MW-FE-001, MW-FE-008

### S2 — Wompi widget MITM
- Attacker on coffee shop WiFi serves modified widget.js
- Browser checks SRI hash, mismatch detected
- Script blocked, Wompi iframe never loads
- User sees error message
- **Closes**: MW-FE-002

### S3 — CSRF attack
- Attacker hosts page on evil.com with form targeting `https://market.opitacode.com/api/wallet/withdraw`
- Victim logged in, visits evil.com
- Browser sends cookies (Lax) but no CSRF token
- Backend rejects: 403 `INVALID_CSRF`
- **Closes**: MW-FE-004

### S4 — XSS injection in evidence photo
- Attacker uploads photo with XSS payload in EXIF metadata
- DPO views evidence in admin panel
- Without CSP: script executes, steals DPO session
- With CSP `script-src 'self'`: inline script blocked
- **Closes**: MW-FE-005, MW-FE-009

### S5 — Clickjacking
- Attacker embeds market.opitacode.com in iframe on evil.com
- Browser checks X-Frame-Options: DENY
- Iframe blocked
- **Closes**: MW-FE-010

## Out of Scope

- Subresource integrity for ALL scripts (only Wompi widget for v1)
- HSTS preload submission (operator decision)
- Web Application Firewall at Cloudflare (separate spec if needed)
