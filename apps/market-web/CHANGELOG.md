# Changelog — Opita Market (market-web)

All notable changes to the public storefront / investor demo are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Pending
- Replace static PNG covers with UGC `<video>` clips once MiniMax video quota resets (~96 min)
- Wire new 9:16 hands-focused keyframes to replace legacy 16:9 hero PNGs

---

## [v0.1.0-demo-1] — 2026-06-28

### Added
- **16-act investor demo narrative** at `/demo`: hero, trust marquee, problema, cómo funciona, FeedShowcase, vertical bento, live price board, AlgorithmDeepDive (5 scenarios, 99/100), CreatorEconomy (3 profiles, $935K), Flywheel (B2C×B2B), comparison vs Temu+TikTok+ML+PA, testimonials, roadmap, compliance, final CTA.
- **FeedShowcase component** — TikTok-style horizontal scroll of 6 product video cards (foods / beauty / barber / hogar / fruits / spa) with creator info, business overlay, action buttons, algorithm-reason transparency badges.
- **DemoLayout** with sticky navbar (logo + 4 verticals + Saldo widget), pre-footer dark investor CTA + newsletter, 5-column footer.
- **25+ demo components** (Container, Section, Card, Badge, Button, RatingStars, BusinessCard, VerticalTile, PriceBoardRow, AlgorithmTrace, BgPattern, StatCounter, Timeline, ComparisonTable, Testimonial, FloatingCards, BentoGrid+Card, ChapterMarker, FeedCard, FeedShowcase, AlgorithmDeepDive, CreatorEconomy, Flywheel).
- **OKLCH brand design system** in `global.css`: terracotta, coffee brown, Andean green, Magdalena blue, parchment cream, deep night. Fluid type via `clamp()`, motion tokens, focus-visible, prefers-reduced-motion.
- **Demo data layer**: 4 verticals + 20 sample businesses + 8 price-board entries + 5 worked algorithm scenarios (Neiva arepas, Medellín barber, Bogotá huilense, Pereira centro, Neiva plomero).
- **Anti-dark-patterns audit** per `opita-frontend-behavior` skill (Habeas Data UX, no fake urgency, transparent algorithm).

### Security & Compliance
- Habeas Data Ley 1581/2012 compliance (PTD, Aviso de Privacidad, DPO dashboard, Suprimir mi negocio links in every footer)
- WCAG 2.2 AA focus-visible on every interactive element
- Spanish neutral (no Argentine / Colombian regional markers)
- prefers-reduced-motion respected

### Infrastructure
- Migrated from `astro-sst` to `@astrojs/cloudflare` adapter (PR cf-hybrid, 2026-06-26). Edge SSR, ~30s deploys.
- Cloudflare Pages project `opita-market-dev` deployed to staging branch.
- Custom domain: `market-dev.opitacode.com` (production goes to `market.opitacode.com` once DNS is set).

### Fixed
- Previous staging deploy (`0e3d493`) returned 200 only for `/`, 404 for `/demo` and `/legal/*`. Root cause: missing `_worker.js` invocation (only static fallback served). Fix: fresh `astro build` + `wrangler pages deploy dist --project-name opita-market-dev --branch=staging` correctly bundles the SSR worker.
- Verified all 16 acts and 6 demo routes (`/demo`, `/demo/foods`, `/demo/barber`, `/demo/beauty`, `/demo/hogar`, `/demo/lobby/{slug}`) return 200 on staging.

### Deployment URLs (verified 2026-06-28)
- **Staging (PRIMARY)**: https://staging.opita-market-dev.pages.dev/demo
- **Deployment alias**: https://9a46250f.opita-market-dev.pages.dev/demo
- **Custom domain**: https://market-dev.opitacode.com/demo (root works; `/demo` 404 because custom domain points to production branch — production deploy needed)
- **Pages project**: `opita-market-dev` (id: 64acc290-3c48-4d29-9035-b7fce8b24b79)
- **Production branch**: `main`
- **Latest deployment id**: 9a46250f-…

### Tag
`v0.1.0-demo-1` at commit `867fe8a` (HEAD = `test(market-web): STAGING UI E2E test (18/18 PASS)`)

---

## Conventions (this is the first entry — establishing the pattern)

### Versioning
- `v0.1.0-demo-N` — demo content iteration (N increments as FeedShowcase/videos get added)
- `v0.2.0` — staging → production promotion (custom domain swap, DNS, hardening)
- `v1.0.0` — first public release

### Branches
- `main` — production branch (auto-deploys to `market.opitacode.com` once DNS set)
- `staging` — preview branch (auto-deploys to `market-dev.opitacode.com`)

### Deploy commands (canonical, copy-paste-ready)

```powershell
# 1. Load env vars per cloudflare-pages-deploy skill Step 0
$env:CLOUDFLARE_API_KEY = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_API_KEY", "User")
$env:CLOUDFLARE_API_TOKEN = $env:CLOUDFLARE_API_KEY  # wrangler uses CLOUDFLARE_API_TOKEN
$env:CLOUDFLARE_EMAIL = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_EMAIL", "User")
$env:CLOUDFLARE_ACCOUNT_ID = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID", "User")

# 2. Build + deploy
cd apps/market-web
npm run build
npx wrangler pages deploy dist --project-name opita-market-dev --branch=staging --commit-dirty=true

# 3. Verify (per skill rule 11)
$r = Invoke-WebRequest -Uri "https://staging.opita-market-dev.pages.dev/demo" -Method Head -UseBasicParsing
$r.StatusCode  # must be 200
```

### Open issues (must fix before production)
1. `PUBLIC_PTD_TELEFONO` is a placeholder (`+57 8 8700000`). Operator must set real phone before go-live (Ley 1581 Art. 13).
2. `PUBLIC_JWT_SECRET` is `PLACEHOLDER-update-with-real-opita-account-ui-jwt-secret` — must be set via `wrangler pages secret put`.
3. `DEV_MOCK_AUTH = "true"` — must be `"false"` for production.
4. DNS for `market.opitacode.com` not yet configured (currently `market-dev.opitacode.com` is the only custom domain).