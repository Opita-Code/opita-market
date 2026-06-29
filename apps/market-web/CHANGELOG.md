# Changelog — Opita Market (market-web)

All notable changes to the public storefront / investor demo are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Pending
- Replace static PNG covers with UGC `<video>` clips once MiniMax video quota resets
- Add `<video autoplay loop muted playsinline poster>` support to FeedCard when videos arrive

---

## [v0.1.0-demo-5] — 2026-06-28

### Fixed
- **Voseo (dialecto argentino) en subpáginas del demo.** Reemplazos:
  - `/demo/foods`: "Pedí" → "Pide", "¿Qué buscás?" → "¿Qué buscas?", "¿Tenés/vendés?" → "¿Tienes/vendes?"
  - `/demo/barber`: "¿Sos barbero y querés aparecer?" → "¿Eres barbero y quieres aparecer?", "Reservá/Pagá" → "Reserva/Paga"
  - `/demo/beauty`: "¿Tenés un centro de belleza?" → "¿Tienes un centro de belleza?"
  - `/demo/hogar`: "¿Sos profesional del hogar?" → "¿Eres profesional del hogar?"
  - `/demo/lobby/[slug]`: "¿Sos el dueño?" → "¿Eres el dueño?"
  - `/lib/demo-data.ts`: "Encontrá/Reservá/Compará/Pedí" → neutrales
- **Typo "datéfono" → "datáfono"** (en español es "datáfono", no "datéfono"). Corregido en 5 lugares: `/pages/demo/index.astro` (testimonio), `/lib/algorithm.ts` (2x), `/lib/demo-algorithm.ts`, `/lib/demo-data.ts`, `/components/demo/Flywheel.astro`.

### Changed
- **Jerga yanqui removida**: `$5M pre-seed a16z` (en `/demo/beauty`) — referencia a VC Silicon Valley no comunica nada a inversionistas tradicionales. Mantenido el badge "Inspirado en Morado" (referencia local colombiana).
- **Teléfono real +57 312 6126085** reemplaza el placeholder `+57 8 8700000 (staging)` en `wrangler.toml` y `src/lib/legal-secrets.generated.ts`. Cumple Ley 1581 Art. 13 con el número del DPO. Tipografía corregida en `.generated.ts` (tenía `;;` por error en un edit anterior).

### Deployment
- **Tag**: `v0.1.0-demo-5`
- **Commit**: `d2b5d97`
- **Staging URL**: https://staging.opita-market-dev.pages.dev/demo

---

## [v0.1.0-demo-4] — 2026-06-28

### Fixed
- **`{{TELEFONO}}` literal rendered in `/legal/ptd`** (Ley 1581 Art. 13 requires company phone on PTD). Root cause: TELEFONO was missing from the remark plugin's SECRETS dict, AND the remark plugin is being lost during Astro 5's content-layer data serialization. Fix: (1) added TELEFONO to `src/lib/remark-substitute-legal-placeholders.ts` SECRETS dict, (2) switched the build command to `node scripts/build.js` which pre-substitutes tokens in legal markdown files before Astro's content layer caches them (then restores originals for DPO review).

### Added — Brand kit (production-grade)
- **`public/favicon.ico`** — multi-size ICO (16+32+48) for browsers
- **`public/apple-touch-icon.png`** — 180x180 with full-bleed cream background (iOS bookmarks)
- **`public/og-image.png`** — 1200x630 Open Graph preview for social share (logo + tagline + URL)
- **`public/site.webmanifest`** — PWA manifest (name, icons, theme color)
- **`public/robots.txt`** — SEO crawler rules (allow demo, disallow admin/api)
- **`public/sitemap.xml`** — 7-URL sitemap (home, demo, 4 verticals, aviso)
- **`public/logo/mark-512.png`** — mark only (icon), 512x512, transparent BG
- **`public/logo/mark-192.png`** — PWA icon size
- **`public/logo/mark-32.png`** — favicon-size
- **`public/logo/horizontal-512x128.png`** — mark + "Opita Market" wordmark horizontal
- **`public/logo/vertical-256x256.png`** — mark + wordmark stacked (replaces the old `/demo/logo/square.png` poster)
- **`scripts/opita-assets/generate_logos.py`** — generator script (Pillow primitives, no SVG dependencies; uses brand DNA colors: terracotta `#a85a32`, coffee brown `#6b3a1c`, parchment cream `#f8f1e3`)

### Changed
- **DemoLayout.astro + BaseLayout.astro** — added `<link>` tags for favicon, apple-touch-icon, manifest, plus `<meta>` tags for og:image, twitter:card, theme-color
- **DemoLayout.astro navbar + footer** — replaced `/demo/logo/square.png` (the old "poster" with tiny logo on huge cream background) with `/logo/mark-192.png` (real transparent-background mark)

### Design language (brand consistency)
- All assets use the same brand DNA from `scripts/opita-assets/design-system.md`:
  - **Terracotta** `#a85a32` (Huila coffee, Andean earth) — awning stripes
  - **Coffee brown** `#6b3a1c` (shadows, depth, wood) — "O" letterform, wordmark
  - **Parchment cream** `#f8f1e3` (backgrounds, light surfaces) — circle interior
  - **Andean green** `#3a8c4e` (secondary, foliage)
  - **Deep night** `#2c2520` (type, contrast)
- The "O with market-stall awning" motif is preserved across all sizes (32px favicon → 1200×630 OG image) — recognizable at any scale

### Deployment
- **Tag**: `v0.1.0-demo-4`
- **Commit**: `30797aa`
- **Staging URL**: https://staging.opita-market-dev.pages.dev/demo

---

## [v0.1.0-demo-3] — 2026-06-28

### Changed
- **Reemplazo de jerga en inglés por español claro** en todo el demo (operador feedback: "los inversionistas son más a la antigua con lenguaje claro"). Cambios visibles al usuario:
  - `Watch-time predictivo` → `Tiempo de visualización`
  - `Nicho affinity` → `Gustos parecidos`
  - `Creator affinity` → `Creadores que sigues`
  - `Diversity` → `Variedad`
  - `Recencia` → `Novedad`
  - `Network effect` → `Efecto red`
  - `Status quo` → `Lo de hoy`
  - `UGC` → `Videos hechos por la gente`
  - `TikTok-style` → (eliminado del copy visible)
  - `creator economy` → `cómo ganan los creadores`
  - `social commerce` (CTA) → `comercio por redes sociales`
  - `PyMEs` (CTA) → `negocios`
  - `thesis` (CTA) → `invertir en`
  - ACT 9 title: `Creadores` → `Cómo ganan los que publican`
  - ACT 10 title: `El flywheel` → `El círculo virtuoso`
- Mantengo en inglés (proper nouns): TikTok, Temu, Nequi, Bre-B, Daviplata, LATAM, Habeas Data, NIT, DPO, RUES (términos legales colombianos).

### Deployment
- **Tag**: `v0.1.0-demo-3`
- **Commit**: `8504c1b`
- **Staging URL**: https://staging.opita-market-dev.pages.dev/demo

---

## [v0.1.0-demo-2] — 2026-06-28

### Changed
- **Replaced 4 vertical hero illustrations** with 9:16 brand-aligned keyframes generated via MiniMax Director Pipeline (hands-focused, hyper-specific Colombian characters, warm earth-tone palette, upper-left golden-hour sun).
  - `foods.jpg` (720x1280): María, 60s, hands placing steaming lechona in Huila kitchen with terracotta tiles + aguadepanela mug
  - `barber.jpg` (720x1280): Don Hernán, 52s, clippers trimming fade, sage-green painted window frame
  - `beauty.jpg` (720x1280): Manicurista, 40s, gel polish brush touching fingertips, marble counter + monstera
  - `hogar.jpg` (720x1280): Plumber, 40s, hands on pipe wrench under sink, scattered wrenches on floor
- **Renamed `.png` → `.jpg`**: content is JPEG (downloaded from MiniMax OSS). Extension matches content. CF Pages now serves `Content-Type: image/jpeg` correctly.
- **FeedShowcase.astro updated**: all 6 `videoSrc` references now point to `.jpg`. Same hash-keyed content delivery, no visual regression.

### Notes
- 4 images = 1.09 MB total (279+265+287+301 KB), all 9:16 vertical, JPEG quality ~85
- CF Pages quirk discovered: requesting `.png` of a renamed asset returns 200 with same content + wrong CT (image/png). Doesn't break anything since FeedShowcase references `.jpg`, but worth noting for future asset renames.

### Deployment
- **Tag**: `v0.1.0-demo-2`
- **Commit**: `8e770d8`
- **Staging URL**: https://staging.opita-market-dev.pages.dev/demo (deployment alias: https://5e2c78f1.opita-market-dev.pages.dev)

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