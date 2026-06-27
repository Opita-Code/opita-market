# Design: opita-pagos-foundation

## 1. Architecture Overview

```
                    ┌──────────────────────────────────────────────────┐
                    │              apps/market-web (Astro 6)            │
                    │  MarketCheckoutModal · WalletWidget · TierBadge  │
                    │  (React 19 islands, hydrated per interaction)     │
                    └──────────────────────┬───────────────────────────┘
                                           │ HTTPS
                                           ▼
                    ┌──────────────────────────────────────────────────┐
                    │       Cloudflare (proxy + WAF + cache)            │
                    │       market.opitacode.com  →  market-dev...      │
                    └──────────────────────┬───────────────────────────┘
                                           │ HTTPS (Lambda Function URL via SST Router)
                                           ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                          PagosAPI (Hono Lambda)                              │
   │  ┌────────────────────────────────────────────────────────────────────────┐  │
   │  │  Routes:                                                                │  │
   │  │    /v1/payments/intent · /webhook · /{id}/refund · /{id}/dispute        │  │
   │  │    /v1/wallet/{u}/balance · /topup · /withdraw · /transfer              │  │
   │  │    /v1/tier/{u} · /{u}/promote · /v1/bonuses/{u}/balance               │  │
   │  │    /v1/referrals/create · /v1/delivery/confirm                          │  │
   │  │    /v1/emergency/kill-switch (Cognito dpo group only)                   │  │
   │  └────────────────────────────────────────────────────────────────────────┘  │
   │                                                                              │
   │  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
   │  │  Wompi client   │  │  Anti-fraud      │  │  Bonus engine             │   │
   │  │  (signature,    │  │  engine          │  │  (20 rules, cooldowns,    │   │
   │  │  webhook verify)│  │  (12 signals)    │  │  chargeback-aware)        │   │
   │  └────────┬────────┘  └────────┬─────────┘  └────────────┬─────────────┘   │
   │           │                    │                         │                  │
   │  ┌────────▼────────────────────▼─────────────────────────▼──────────────┐   │
   │  │              Ledger ops (append-only, optimistic concurrency)         │  │
   │  └──────────────────────────────────────────────────────────────────────┘   │
   │                                                                              │
   │  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
   │  │  IP geolocation │  │  Tier manager    │  │  Escrow manager           │   │
   │  │  (cache + MM    │  │  (promotion,     │  │  (HELD/RELEASED/DISPUTED) │   │
   │  │   + IP2Proxy    │  │   limits, 3DS)   │  │                           │   │
   │  │   + RIPEstat)   │  │                  │  │                           │   │
   │  └─────────────────┘  └──────────────────┘  └──────────────────────────┘   │
   └─────────────────┬────────────────┬────────────────┬──────────────────────┘
                     │                │                │
                     ▼                ▼                ▼
   ┌─────────────────────────┐ ┌─────────────────────────────────┐ ┌──────────────┐
   │  DynamoDB Tables (7)    │ │  Aurora Postgres (existing)     │ │  Lambda      │
   │  MarketWallets          │ │  representative_consented.      │ │  Layer       │
   │  MarketLedger (immut.)  │ │    audit_log (WORM 5y)          │ │  GeoIpLayer  │
   │  MarketTransactions     │ │  + market_payment_audit (new)   │ │  ┌────────┐  │
   │  MarketReferrals        │ │    FK → MarketTransactions       │ │  │ GeoCity│  │
   │  MarketBonuses          │ │    FK → MarketWallets            │ │  │ .mmdb  │  │
   │  IpGeoCache (TTL 7d)    │ └─────────────────────────────────┘ │  │ IP2Proxy│ │
   │  FraudSignals (TTL 30d) │                                     │  │ .bin    │  │
   └─────────────────────────┘                                     │  └────────┘  │
                                                                  └──────────────┘

   ┌──────────────────────────────────────────────────────────────────────────────┐
   │              Reuses (via @opita-market/compliance-service)                    │
   │   - Verifik client (NIT+DV validation)                                       │
   │   - Cognito 3-tier auth middleware                                            │
   │   - Audit log emitter → representative_consented.audit_log                   │
   └──────────────────────────────────────────────────────────────────────────────┘
```

## 2. File Structure

```
opita-market/
├── packages/
│   └── pagos-service/                            # NEW — parallel to compliance-service
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts                          # Lambda entry — exports handler
│       │   ├── api/
│       │   │   ├── index.ts                      # Hono app factory + hono/aws-lambda handle()
│       │   │   ├── payments.ts                   # /v1/payments/*
│       │   │   ├── wallet.ts                     # /v1/wallet/*
│       │   │   ├── tier.ts                       # /v1/tier/*
│       │   │   ├── bonuses.ts                    # /v1/bonuses/*
│       │   │   ├── referrals.ts                  # /v1/referrals/*
│       │   │   ├── delivery.ts                   # /v1/delivery/* (transportadora webhook)
│       │   │   └── emergency.ts                  # /v1/emergency/* (kill-switch, DPO only)
│       │   ├── lib/
│       │   │   ├── wompi.ts                      # Signature gen + webhook HMAC verify
│       │   │   ├── ledger.ts                     # Append-only ledger ops + balance projection
│       │   │   ├── tiers.ts                      # Tier definitions + limits
│       │   │   ├── fraud.ts                      # Anti-fraud engine (12 signals)
│       │   │   ├── ip-geolocation.ts             # IP geo lookup chain orchestrator
│       │   │   ├── maxmind-loader.ts             # Loads .mmdb from Lambda Layer
│       │   │   ├── ip2proxy-loader.ts            # Loads .bin from Lambda Layer
│       │   │   ├── bonuses.ts                    # Bonus engine + rule registry
│       │   │   ├── bonus-rules.ts                # 20 config-driven bonus rules
│       │   │   ├── escrow.ts                     # HELD → RELEASED → DISPUTED state machine
│       │   │   ├── referrals.ts                  # Referral code gen + qualification logic
│       │   │   ├── auth.ts                       # Cognito 3-tier middleware (re-exports compliance)
│       │   │   ├── errors.ts                     # Typed errors (FRAUD_BLOCKED, WITHDRAW_HOLD_NOT_ELAPSED, ...)
│       │   │   ├── money.ts                      # Integer-only COP math (no float)
│       │   │   └── audit.ts                      # Emits to representative_consented.audit_log
│       │   ├── db/
│       │   │   ├── tables.ts                     # DynamoDB type bindings (already drafted)
│       │   │   ├── schema.sql                    # Postgres immutability triggers + payment_audit table
│       │   │   └── migrations/                   # versioned migration files
│       │   └── types/
│       │       └── index.ts                      # Shared API request/response types
│       ├── crons/
│       │   ├── reconciliation.ts                 # Daily 03:00 COL — DynamoDB vs Wompi webhook log
│       │   ├── streak-evaluator.ts               # Daily 00:00 COL — fire streak bonuses
│       │   ├── tor-refresh.ts                    # Daily — refresh Tor exit list cache
│       │   └── uiaf-monitor.ts                   # Hourly — detect threshold breaches
│       ├── scripts/
│       │   ├── download-geoip-databases.ts       # One-time setup — fetch .mmdb and .bin
│       │   └── seed-test-data.ts                 # Dev/local only
│       └── tests/
│           ├── unit/
│           │   ├── tiers.test.ts
│           │   ├── money.test.ts
│           │   ├── ledger.test.ts
│           │   ├── wompi-signature.test.ts
│           │   ├── wompi-webhook-verify.test.ts
│           │   ├── fraud-engine.test.ts           # All 12 signal types + decision matrix
│           │   ├── bonus-engine.test.ts          # All 20 rules + cooldowns
│           │   ├── ip-geolocation.test.ts        # Mocked lookup chain
│           │   ├── escrow-state-machine.test.ts
│           │   └── referrals.test.ts
│           ├── integration/
│           │   ├── payment-orchestration.test.ts # Full intent → webhook → wallet credit
│           │   ├── wallet-lifecycle.test.ts      # Concurrent ops, ledger immutability
│           │   ├── tier-promotion.test.ts
│           │   ├── fraud-decision-flow.test.ts   # End-to-end fraud → BLOCK/REVIEW
│           │   ├── bonus-on-purchase.test.ts
│           │   ├── escrow-flow.test.ts           # HELD → RELEASED on delivery
│           │   ├── chargeback-reversal.test.ts
│           │   ├── ip-cache-ttl.test.ts          # DynamoDB TTL behavior
│           │   ├── referral-flow.test.ts
│           │   ├── referral-anti-fraud.test.ts
│           │   └── reconciliation.test.ts        # DynamoDB ledger vs Wompi webhook log
│           └── e2e/
│               └── checkout-flow.spec.ts         # Playwright — full UX flow
│
├── apps/
│   └── market-web/
│       └── src/
│           ├── components/market/
│           │   ├── MarketCheckoutModal.tsx       # React island
│           │   ├── WalletWidget.tsx
│           │   ├── TierBadge.tsx
│           │   └── ReferralCodeCard.tsx
│           └── lib/
│               ├── wompi-widget.ts               # Injects <script src=checkout.wompi.co/widget.js>
│               ├── api-client.ts                 # Typed fetch wrapper for PagosAPI
│               └── tier-display.ts               # Maps tier → badge color/icon
│
└── sst.config.ts                                 # MODIFIED — add PagosAPI + 7 tables + GeoIpLayer
```

## 3. DynamoDB Tables (Detailed)

### 3.1 MarketWallets
```
PK: user_id (string)            — Cognito email, e.g., "user@example.com"
Attributes:
  balance_cop: number            — Integer, always >= 0
  balance_coins: number          — Integer (1:1 with COP for now; future-proof for differential)
  tier: number (0|1|2|3|4)
  kyc_state: "INCOMPLETE" | "PENDING" | "VERIFIED" | "REJECTED"
  referral_code: string          — 8 chars, unique (LSI)
  last_activity_at: string (ISO)
  lifetime_received_cop: number
  lifetime_withdrawn_cop: number
  created_at: string (ISO)
  updated_at: string (ISO)
  version: number                — optimistic concurrency
LSI:
  ReferralCodeIndex              — referral_code (string) → user_id
```

### 3.2 MarketLedger (APPEND-ONLY, IMMUTABLE)
```
PK: user_id (string)
SK: ts_seq (string)              — "{ISO-timestamp}#{6-digit-zero-padded-seq}"
                                  — e.g., "2026-06-26T10:00:00.123Z#000001"
                                  — ensures strict chronological ordering even under ms ties
Attributes:
  movement: "DEPOSITO" | "RETIRO" | "TRANSFER_IN" | "TRANSFER_OUT" | "BONUS" | "COMISION" | "REFUND"
  amount_cop: number             — signed; positive=credit, negative=debit
  balance_after_cop: number      — projection at this moment
  transaction_id?: string
  bonus_rule_id?: string
  metadata?: map<string, any>
```
**Immutability**: enforced by Postgres trigger (`market_ledger_immutable` — REJECTS UPDATE/DELETE).
DynamoDB item is the write-side; Postgres is the audit-side replica via CDC.

### 3.3 MarketTransactions
```
PK: transaction_id (string)      — ULID, sortable, unique
Attributes:
  wompi_tx_id?: string
  intent: "PAYMENT" | "WITHDRAWAL" | "TRANSFER" | "REFUND"
  channel: "WOMPI_CARD" | "WOMPI_BREB" | "WOMPI_PSE" | "WOMPI_NEQUI" | "WOMPI_DAVIPLATA" | "INTERNAL_TRANSFER"
  status: "PENDING" | "APPROVED" | "DECLINED" | "VOIDED" | "REFUNDED" | "ERROR"
  amount_cop: number
  reference: string              — Format: "TYPE::USER::TS" (set by client, idempotency)
  idempotency_key: string
  from_user_id?: string
  to_user_id?: string
  wompi_payment_method?: string  — CARD | NEQUI | BANCOLOMBIA | PSE
  product_context?: map          — {kind, ref_id}
  escrow_state: "NONE" | "HELD" | "RELEASED" | "DISPUTED" | "REFUNDED"
  escrow_released_at?: string (ISO)
  dispute_window_ends_at?: string (ISO)
  webhook_events: list<map>      — audit trail of all webhook calls
  fraud_signals: list<string>    — signal_ids that fired
  created_at: string (ISO)
  updated_at: string (ISO)
  version: number
GSIs:
  IdempotencyKeyIndex            — idempotency_key (hash) → transaction_id  [for replay dedup]
  WompiTxIdIndex                 — wompi_tx_id → transaction_id              [for webhook dedup]
  StatusUpdatedAtIndex            — status + updated_at                      [for reconciliation cron]
  UserFromIndex                  — from_user_id + created_at                [for buyer history]
  UserToIndex                    — to_user_id + created_at                  [for seller history]
```

### 3.4 MarketReferrals
```
PK: referrer_user_id (string)
SK: referee_user_id (string)
Attributes:
  referral_code: string
  status: "PENDING" | "QUALIFIED" | "PAID" | "REJECTED"
  qualified_at?: string (ISO)
  bonus_paid_at?: string (ISO)
  bonus_amount_cop: number
  reject_reason?: string          — "SELF_REFERRAL" | "IP_DUPLICATE" | "DEVICE_DUPLICATE"
  created_at: string (ISO)
GSI:
  RefereeIndex                   — referee_user_id → referrer_user_id  [for lookup by referee]
```

### 3.5 MarketBonuses
```
PK: user_id (string)
SK: rule_id#ts (string)          — e.g., "WELCOME_CELL_VERIFIED#2026-06-26T10:00:00.123Z"
Attributes:
  applied: boolean               — false if cooldown / already-claimed
  amount_cop: number
  multiplier: number
  cooldown_until?: string (ISO)
  context: string                — what triggered it
  transaction_id?: string        — for chargeback reversal lookup
  reversed: boolean
  reversed_at?: string (ISO)
  created_at: string (ISO)
```

### 3.6 IpGeoCache (TTL 7 days)
```
PK: ip (string)
Attributes:
  country_iso: string            — "CO"
  country_name: string           — "Colombia"
  region: string                 — "Huila"
  city: string                   — "Neiva"
  postal_code?: string
  latitude?: number
  longitude?: number
  asn: number
  asn_org: string                — "UNE EPM Telecomunicaciones"
  isp: string
  is_proxy: boolean
  is_vpn: boolean
  is_tor: boolean
  is_datacenter: boolean
  is_mobile: boolean
  confidence: number             — 0.0-1.0
  source: "MAXMIND" | "RIPESTAT" | "TOR_LIST" | "ABUSEIPDB" | "TEAMCYMRU"
  cached_at: string (ISO)
  expires_at: number             — Unix seconds, DynamoDB TTL
```
TTL via DynamoDB native TTL (set on `expires_at`).

### 3.7 FraudSignals (TTL 30 days)
```
PK: signal_id (string)           — ULID
Attributes:
  ts: string (ISO)
  user_id: string
  ip_hash: string                — SHA-256(ip)[:16] (privacy)
  device_id?: string
  signal_type: "VELOCITY_EXCEEDED" | ... | "SUSPICIOUS_TIMING"
  weight: number                 — 0-1
  context: map<string, any>
  acted_on: boolean
  decision: "ALLOW" | "REVIEW" | "BLOCK"
  expires_at: number
GSI:
  UserTsIndex                    — user_id + ts         [for fraud dashboard query]
```

## 4. Lambda Layer: GeoIpLayer

Single Lambda Layer (size ~25MB, fits in 50MB unzipped limit):

```
geoip-layer.zip
├── nodejs/
│   ├── node_modules/
│   │   ├── @maxmind/geoip2-node/             # MaxMind reader
│   │   └── ip2proxy-nodejs/                 # IP2Proxy reader
│   ├── data/
│   │   ├── GeoLite2-City.mmdb               # MaxMind country+city+ASN
│   │   └── IP2Proxy-PX2.BIN                 # IP2Proxy LITE proxy detection
│   └── version.txt
```

**Setup script**: `scripts/download-geoip-databases.ts`
- Reads `MAXMIND_LICENSE_KEY` from env
- Downloads from `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&...`
- Downloads IP2Proxy from `https://lite.ip2location.com/ip2proxy-lite`
- Builds zip → publishes to SST as Lambda Layer

**Layer consumer**: `PagosAPI` Lambda adds `GeoIpLayer` to its layers list.

## 5. API Contracts

### POST /v1/payments/intent
```
Request:
  Headers:
    Authorization: Bearer <cognito-jwt>
    Cookie: opita_id_token=...; opita_session=...
    Idempotency-Key: <uuid>     (required, max 64 chars)
    X-Device-Id: <uuid>         (required for fraud engine)
  Body:
    {
      amount_cop: number,       // integer, > 0
      channel: "WOMPI_CARD" | "WOMPI_BREB" | "WOMPI_PSE",
      from_user_id: string,     // buyer
      to_user_id: string,       // seller
      product_context: {
        kind: "LOBBY_BOOST" | "TENANT_PLAN" | "MARKETPLACE_ORDER" | "P2P_TRANSFER",
        ref_id: string
      },
      device_id?: string,       // for fraud; same as header
      ip?: string               // for fraud; auto-detected from event
    }

Response 200:
    {
      transaction_id: string,
      reference: string,        // pass to Wompi widget
      amount_in_cents: number,  // same as amount_cop
      currency: "COP",
      integrity_signature: string,  // SHA256(reference + amount + currency + WOMPI_INTEGRITY_SECRET)
      public_key: string,        // WOMPI_PUBLIC_KEY
      requires_3ds: boolean,
      expires_at: string (ISO)   // 30 min from now
    }

Response 409: { error_code: "IDEMPOTENT_KEY_REUSED", original_transaction_id }
Response 422: { error_code: "TIER_LIMIT_EXCEEDED" | "AMOUNT_INVALID" | "CHANNEL_NOT_ALLOWED" }
Response 403: { error_code: "FRAUD_BLOCKED", signals: [...] }
Response 401: { error_code: "UNAUTHENTICATED" }
Response 500: { error_code: "INTERNAL_ERROR", trace_id }
```

### POST /v1/payments/webhook (Wompi → us)
```
Request:
  Headers:
    X-Signature: <wompi-timestamp-based-hmac>   (we verify via WOMPI_WEBHOOK_SECRET)
  Body (from Wompi):
    {
      event: "transaction.updated",
      data: { transaction: { id, reference, status, amount_in_cents, currency, payment_method_type } },
      signature: { properties: ["transaction.id", "transaction.status", ...], checksum, timestamp },
      timestamp: number
    }

Response 200: { ok: true }
Response 401: { error_code: "INVALID_SIGNATURE" }   // never expose details
Response 200: { ok: true, deduplicated: true }      // when same tx_id replayed
```

### POST /v1/payments/{id}/refund (admin)
```
Request:
  Headers: Authorization (Cognito group: dpo)
  Body: { reason: string, amount_cop?: number }     // amount optional = full refund

Response 200: { refund_id: string, status: "PROCESSING" }
Response 403: { error_code: "FORBIDDEN_NOT_DPO" }
Response 422: { error_code: "ALREADY_REFUNDED" | "INVALID_STATE" }
```

### POST /v1/payments/{id}/dispute (buyer)
```
Request:
  Headers: Authorization
  Body: { reason: "NOT_RECEIVED" | "DAMAGED" | "NOT_AS_DESCRIBED", description: string, evidence_urls: string[] }

Response 200: { dispute_id: string, status: "OPEN", dpo_notified_at: ISO }
Response 422: { error_code: "DISPUTE_WINDOW_CLOSED" | "NOT_BUYER" | "INVALID_STATE" }
```

### GET /v1/wallet/{user}/balance
```
Response 200:
    {
      user_id: string,
      balance_cop: number,
      tier: 0|1|2|3|4,
      kyc_state: string,
      trust_badge: string | null,
      receive_limit_day_cop: number,
      receive_limit_day_used_cop: number,
      receive_limit_day_remaining_cop: number,
      withdraw_limit_day_cop: number,
      withdraw_limit_day_used_cop: number,
      withdraw_limit_day_remaining_cop: number,
      withdraw_hold_hours: number,
      referral_code: string,
      updated_at: ISO
    }
```

### POST /v1/wallet/{user}/topup  (initiates a payment to self — buyer = seller in this case)
```
Body: { amount_cop: number, channel: ..., idempotency_key: string }
Response 201: { transaction_id: string, reference: string, ... }   // returns intent data
```

### POST /v1/wallet/{user}/withdraw
```
Body: { amount_cop: number, destination: { kind: "BREB", phone: "+57..." } }
Response 200: { withdrawal_id: string, status: "PROCESSING", available_at: ISO }
Response 422: { error_code: "WITHDRAW_HOLD_NOT_ELAPSED" | "INSUFFICIENT_BALANCE" | "AMOUNT_EXCEEDS_DAY_LIMIT" }
```

### POST /v1/wallet/{user}/transfer  (P2P, internal)
```
Body: { amount_cop: number, to_user_id: string, memo?: string }
Response 200: { transfer_id: string, status: "COMPLETED" }
Response 422: { error_code: "INSUFFICIENT_BALANCE" | "TIER_LIMIT_EXCEEDED" }
```

### GET /v1/tier/{user}
```
Response 200:
    {
      user_id: string,
      current_tier: 0|1|2|3|4,
      current_tier_name: string,
      trust_badge: string | null,
      progress_to_next_tier: {
        target_tier: 1|2|3|4,
        unmet_requirements: string[],
        next_tier_benefits: string[]
      } | null
    }
```

### POST /v1/tier/{user}/promote
```
Body: { target_tier: 1|2|3|4, evidence: { ... } }
Response 200: { tier: 2, trust_badge: "Vendedor verificado", limits: {...} }
Response 422: { error_code: "MISSING_REQUIREMENTS", unmet: string[] }
```

### POST /v1/referrals/create
```
Body: { referral_code: string }
Response 200: { referral_id: string, status: "PENDING" }
Response 422: { error_code: "SELF_REFERRAL" | "INVALID_CODE" | "IP_DUPLICATE" | "DEVICE_DUPLICATE" }
```

### POST /v1/delivery/confirm (transportadora webhook)
```
Headers: X-Transportadora-Signature: <hmac>
Body: {
  transaction_id: string,
  delivered_at: ISO,
  recipient_name: string,
  photo_url?: string,
  signature_png?: string,
  tracking_number: string
}
Response 200: { escrow_state: "RELEASED", dispute_window_ends_at: ISO }
Response 422: { error_code: "EVIDENCE_REQUIRED" | "INVALID_SIGNATURE" | "INVALID_STATE" }
```

### POST /v1/emergency/kill-switch (DPO only, Cognito group `dpo`)
```
Body: {
  flag: "SST_API_PAUSED" | "SST_PAYOUTS_PAUSED",
  enabled: boolean,
  reason: string
}
Response 200: { flag: string, enabled: boolean, applied_at: ISO, expires_at: ISO }
```
Stores in DynamoDB `EmergencyFlags` table (single-row, TTL 7d) — checked on every payment intent + withdrawal.

## 6. External Integrations

### 6.1 Wompi
- **Sandbox URL**: `https://sandbox.wompi.co/v1`
- **Production URL**: `https://production.wompi.co/v1`
- **Widget URL**: `https://checkout.wompi.co/widget.js`
- **Auth**: `Authorization: Bearer <WOMPI_PRIVATE_KEY>` for API calls (server-side only)
- **Signature**: SHA-256(reference + amount_in_cents + currency + WOMPI_INTEGRITY_SECRET) for widget
- **Webhook verify**: HMAC-SHA256 over concatenated `signature.properties` values + timestamp + WOMPI_WEBHOOK_SECRET, timing-safe-equal

### 6.2 MaxMind GeoLite2
- Self-hosted `.mmdb` in Lambda Layer (`/opt/data/GeoLite2-City.mmdb`)
- License key from `MAXMIND_LICENSE_KEY` env var
- Lookup via `@maxmind/geoip2-node`
- Update weekly via cron + Lambda that downloads and republishes Layer version

### 6.3 IP2Proxy LITE PX2
- Self-hosted `.bin` in Lambda Layer (`/opt/data/IP2Proxy-PX2.BIN`)
- Direct download from `https://lite.ip2location.com/ip2proxy-lite` (no auth)
- Lookup via `ip2proxy-nodejs`
- Update bi-weekly (cron)

### 6.4 RIPEstat (existing)
- Direct API: `https://stat.ripe.net/data/{type}/data.json`
- ASN lookup: `https://stat.ripe.net/data/as-overview/data.json?resource=AS{asn}`
- No auth required
- Already integrated via `dark-recon_asn_info` — re-use or call directly

### 6.5 Verifik (existing compliance-service)
- `createVerifikClient({ apiKey: VERIFIK_API_KEY, baseUrl: VERIFIK_BASE_URL })`
- `lookupNit(nit, dv)` for tier-2 promotion
- SST Secret `VerifikApiKey` already wired

### 6.6 Cognito (existing)
- User pool `us-east-1_LItAcj2Aa`
- 3-tier auth (Bearer → `opita_id_token` → `opita_session`) — extract from compliance-service as shared module
- Groups: `dpo`, `admin`, `tenant-owner` — DPO group gates `/v1/emergency/*` and `/v1/payments/{id}/refund`

### 6.7 SES (existing) + SNS (existing)
- DPO email for fraud alerts, dispute notifications, reconciliation mismatches
- SNS topic `DpoAlerts` (existing) for pagers/critical incidents

## 7. Postgres Schema (new)

```sql
-- File: packages/pagos-service/src/db/schema.sql

CREATE TABLE IF NOT EXISTS market_payment_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id TEXT NOT NULL,
  event TEXT NOT NULL,           -- 'payment.intent.created' | 'webhook.received' | 'ledger.appended' | etc.
  transaction_id TEXT,
  amount_cop BIGINT,
  ip_hash TEXT,                  -- SHA-256[:16] for privacy
  metadata JSONB,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES representative_consented.users(email) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_user_ts ON market_payment_audit (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_payment_audit_tx ON market_payment_audit (transaction_id);

-- DynamoDB is the write-side, Postgres is the audit-side (via CDC).
-- Schema segregation per Ley 1581/2012: this table lives in `representative_consented`.

-- Immutability triggers
CREATE OR REPLACE FUNCTION market_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'market_ledger rows are immutable (UPDATE/DELETE forbidden)';
END;
$$ LANGUAGE plpgsql;

-- Applied to the DynamoDB ledger replica if/when one is created.
-- For now, DynamoDB's IAM policy forbids PutItem with UPDATE action on existing keys.

-- Note: DynamoDB is the source of truth for live ledger.
-- Postgres `market_payment_audit` is WORM audit (append-only via REVOKE UPDATE/DELETE).
REVOKE UPDATE, DELETE ON market_payment_audit FROM pagos_service_role;
```

## 8. Cron Jobs

| Cron | Schedule (COL) | Handler | Purpose |
|---|---|---|---|
| Reconciliation | 03:00 daily | `crons/reconciliation.ts` | Compare DynamoDB ledger vs Wompi webhook log; alert on discordance |
| Streak evaluator | 00:00 daily | `crons/streak-evaluator.ts` | Fire `STREAK_7_DAYS` / `STREAK_30_DAYS` bonuses |
| Tor list refresh | 04:00 daily | `crons/tor-refresh.ts` | Re-download `torbulkexitlist`, refresh IpGeoCache TTL |
| UIAF monitor | hourly | `crons/uiaf-monitor.ts` | Aggregate today's tx per user; flag any > $5M COP; auto-emit report |
| MaxMind update | weekly Mon 05:00 | `crons/maxmind-update.ts` | Download new `.mmdb`, republish Lambda Layer new version |
| IP2Proxy update | bi-weekly Wed 05:00 | `crons/ip2proxy-update.ts` | Same |

All crons wired via SST `sst.aws.Cron` (same pattern as compliance-service).

## 9. SST Config Additions

```typescript
// sst.config.ts — additions inside `run()`

// 7 DynamoDB tables
const walletsTable = new sst.aws.Dynamo("MarketWallets", {
  fields: { user_id: "string" },
  primaryIndex: { hashKey: "user_id" },
});
const ledgerTable = new sst.aws.Dynamo("MarketLedger", {
  fields: { user_id: "string", ts_seq: "string" },
  primaryIndex: { hashKey: "user_id", rangeKey: "ts_seq" },
});
// ... (similar for other 5 tables)

// Lambda Layer for MaxMind + IP2Proxy
const geoIpLayer = new sst.aws.LayerVersion("GeoIpLayer", {
  code: new sst.asset.File("packages/pagos-service/layer/"),
  compatibleRuntimes: ["nodejs20.x"],
});

// PagosAPI Lambda
const pagosApi = new sst.aws.Function("PagosAPI", {
  url: { cors: false },  // Router handles CORS
  handler: "packages/pagos-service/src/index.handler",
  layers: [geoIpLayer.arn],
  link: [walletsTable, ledgerTable, transactionsTable, /* ...all 7... */],
  environment: {
    WOMPI_PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY || "",
    WOMPI_INTEGRITY_SECRET: process.env.WOMPI_INTEGRITY_SECRET || "",
    WOMPI_WEBHOOK_SECRET: process.env.WOMPI_WEBHOOK_SECRET || "",
    MAXMIND_LICENSE_KEY: process.env.MAXMIND_LICENSE_KEY || "",
    ABUSEIPDB_API_KEY: process.env.ABUSEIPDB_API_KEY || "",
    DB_HOST: db.host,
    // ... DB creds from SST link
  },
  timeout: "30 seconds",
  memory: "1024 MB",  // 1GB to load .mmdb + .bin in memory
  reservedConcurrency: 10,  // cap to prevent runaway
});

// Add to existing api.opitacode.com Router
router.routes["/pagos/*"] = pagosApi.url;
```

## 10. Observability

### CloudWatch Metrics (custom)
- `PagosIntentCreated` (count)
- `PagosWebhookReceived` (count, with `status` dimension)
- `PagosFraudBlocked` (count, with `signal_type` dimension)
- `PagosLedgerAppended` (count, with `movement` dimension)
- `PagosEscrowReleased` (count, with `channel` dimension)
- `PagosReconciliationDiscordance` (count)
- `PagosLatency` (ms, with `endpoint` dimension)

### CloudWatch Logs
- Structured JSON logs: `{ ts, level, trace_id, user_id, action, duration_ms, error }`
- PII redacted (emails hashed, IPs hashed)
- 30-day retention in CloudWatch, 5y archive to S3 (`AuditArchive` bucket, existing)

### X-Ray Tracing
- Enabled on PagosAPI
- Trace every external call: Wompi, MaxMind, IP2Proxy, RIPEstat, Cognito

### Alarms
- `PagosReconciliationDiscordance > 0` → SES to DPO + SNS
- `PagosFraudBlocked > 10/min` → SNS (potential attack)
- `PagosLatency p95 > 1000ms` → SNS
- `PagosAPI errors > 1%` → SNS

## 11. Security

### Threat Model
- **T1: Card fraud** (stolen cards) → mitigated by 3DS + escrow + dispute window
- **T2: Self-referral bonus abuse** → mitigated by IP + device fingerprint dedup + QUALIFIED gate
- **T3: Velocity bypass via multiple devices** → mitigated by per-user velocity (not per-device)
- **T4: Bonus exploitation** → mitigated by cooldowns + chargeback reversal
- **T5: Wompi webhook spoofing** → mitigated by HMAC-SHA256 + timing-safe-equal
- **T6: Idempotency key replay** → mitigated by 24h dedup window
- **T7: PII leak via logs** → mitigated by hashing IPs/emails before logging
- **T8: Secrets in env** → mitigated by SST Secret (KMS-encrypted) + 90-day rotation
- **T9: Lambda code injection** → mitigated by TypeScript strict + no `eval` + input validation
- **T10: DynamoDB tampering** → mitigated by IAM least-privilege + audit log

### Compliance
- Ley 1581/2012: writes to `representative_consented.audit_log` (existing)
- Estatuto Consumidor 1480/2011: prices displayed clearly, retracto within 5 days
- UIAF: tx > $5M auto-reported
- Decreto 222/2020: closed-loop wallet treated as "crédito prepagado no transferible"

## 12. Testing Strategy

### Unit (vitest, in-process)
- All `lib/` modules: 100% coverage target
- `money.ts`: edge cases (overflow, negative, zero)
- `tiers.ts`: all combinations
- `fraud.ts`: all 12 signals + decision matrix
- `bonuses.ts`: all 20 rules + cooldowns
- `wompi.ts`: signature generation + verification (with fixtures from Wompi docs)

### Integration (vitest + testcontainers)
- `payment-orchestration.test.ts`: full intent → webhook → ledger flow with real (test) Wompi mock
- `wallet-lifecycle.test.ts`: 100 concurrent ops via Promise.all
- `chargeback-reversal.test.ts`: simulated refund webhook → ledger reversal
- `ip-cache-ttl.test.ts`: DynamoDB Local + TTL verification
- `referral-flow.test.ts`: signup → qualify → payout
- `reconciliation.test.ts`: inject 100 txs, run reconciliation, expect 0 discordance

### E2E (Playwright)
- `checkout-flow.spec.ts`: full UX from buyer POV
- `payout-flow.spec.ts`: seller view, withdraw to Bre-B

### Coverage Gate
- 90% minimum enforced in `vitest.config.ts` via `coverage.thresholds`
- CI fails if below threshold
- Critical-path modules (`wompi.ts`, `ledger.ts`, `fraud.ts`, `tiers.ts`, `bonuses.ts`, `ip-geolocation.ts`): 100% target

## 13. ADRs (Architectural Decision Records)

### ADR-001: New package `packages/pagos-service/` vs extending `compliance-service`
**Decision**: New package.
**Rationale**: Compliance is regulatory (Ley 1581); payments are transactional. Different lifecycles, different deployment cadences, different security profiles. Bundling would couple unrelated concerns and slow both teams. Reuse happens at the import level (Verifik client, Cognito middleware, audit log emitter) — not at the code level.

### ADR-002: Multi-table DynamoDB design vs single-table
**Decision**: Multi-table (7 tables, one per domain entity).
**Rationale**: Single-table is powerful but adds cognitive load and is hard to evolve. For a payments system where correctness > elegance, multi-table gives:
- Per-table IAM permissions (least privilege)
- Per-table TTL (IpGeoCache 7d, FraudSignals 30d)
- Per-table GSIs that match query patterns
- Per-table CloudWatch Contributor Insights
- Easier onboarding for new engineers
Cost trade-off: 7 tables vs 1 has marginally higher cost (negligible at our scale).

### ADR-003: Money as integer COP, never float
**Decision**: All amounts are `number` representing integer COP. No decimals. No float math.
**Rationale**: COP has no sub-unit. 1 unit = 1 COP. Float introduces rounding errors that compound over millions of transactions. Even BigInt is overkill since COP < 2^53. Plain `number` is safe for our scale ($500M daily limit = 5×10^11, well within 2^53 = 9×10^15).

### ADR-004: Optimistic concurrency via `version` attribute
**Decision**: Every mutable row has a `version: number` attribute. Every update uses `ConditionExpression: version = :expected_version` with `UpdateExpression: SET ..., version = version + 1`.
**Rationale**: Money is lost in race conditions. Pessimistic locking (transactions) is expensive in DynamoDB (long-held locks block throughput). Optimistic concurrency is the idiomatic DynamoDB pattern — fail fast on conflict, retry once or twice with new read.

### ADR-005: Idempotency via `Idempotency-Key` header + DynamoDB conditional write
**Decision**: Client sends `Idempotency-Key: <uuid>` header on every state-changing call. Server hashes the key, attempts `PutItem` with `ConditionExpression: attribute_not_exists(idempotency_key_hash)`. If conflict → return existing transaction.
**Rationale**: Idempotency is non-negotiable for payment APIs (Stripe standard). Header-based is RESTful, easier to test, and survives client retries. DynamoDB conditional write gives atomicity without distributed locks.

### ADR-006: Webhook signature verification via HMAC-SHA256 + `timingSafeEqual`
**Decision**: Wompi webhooks must pass HMAC-SHA256 verification with `crypto.timingSafeEqual`. Reject 401 on any mismatch (never expose reason).
**Rationale**: Constant-time comparison defeats timing attacks. Returning generic 401 doesn't leak which byte mismatched. Both patterns are Node.js idioms.

### ADR-007: Self-hosted MaxMind GeoLite2 + IP2Proxy LITE in Lambda Layer
**Decision**: Download `.mmdb` and `.bin` once, embed in Lambda Layer. No API calls to paid IP geo services.
**Rationale**: $0/month vs $5-50/month per million lookups. MaxMind GeoLite2 is free for low-volume use with attribution. IP2Proxy LITE is free for non-commercial. Self-hosting means our data doesn't leave our infra (privacy win). Lambda cold start adds ~200ms (1GB memory for `.mmdb` load) — acceptable.

### ADR-008: Bonus engine rules in TypeScript config file, not DB
**Decision**: `bonus-rules.ts` exports a typed array of rule definitions. Code change to add a rule, not DB migration.
**Rationale**: Bonus rules are rarely changed (1-2x/year), require code review anyway (financial logic), and need type safety. DB-driven would require admin UI, migration scripts, and risks bad configs. Code-driven is auditable via git blame.

### ADR-009: Streak evaluation via cron, not event-driven
**Decision**: `STREAK_7_DAYS` and `STREAK_30_DAYS` fire from a daily 00:00 COL cron, not from login events.
**Rationale**: Cron is simpler, has exactly-once semantics, and avoids compensating logic for clock drift, missed events, or timezone issues. Event-driven would require aggregating login events and checking thresholds in real-time — more code, more bugs.

### ADR-010: Daily reconciliation cron, not real-time
**Decision**: At 03:00 COL daily, compare DynamoDB `MarketTransactions` (status APPROVED) vs Wompi webhook log. Alert on any discordance.
**Rationale**: Real-time reconciliation is expensive (Wompi API rate limits). Daily is sufficient — any failed webhook shows up within 24h. Discordance alerts via SES to DPO. The cron IS itself the audit log of "did the system work correctly today".

### ADR-011: Bre-B instant release vs escrow
**Decision**: Bre-B payments skip escrow entirely. Credited to seller immediately on APPROVED webhook.
**Rationale**: Bre-B is A2A (account-to-account). Once settled, it's irreversible — no chargeback possible. Holding it in escrow would protect against nothing while reducing seller trust. The product recommendation should nudge buyers to use Bre-B (lower fees, instant release, no 3DS).

### ADR-012: Tier promotion is explicit, not auto-derived
**Decision**: User must call `POST /v1/tier/{user}/promote` with target tier + evidence. Auto-derivation only happens if NIT was already verified by Verifik in a previous flow (Tier 2 auto-promotes if `representative_consented.users.nit_verified = true`).
**Rationale**: Explicit promotion is auditable (who promoted, when, with what evidence). Auto-derivation is convenient but hides intent. Hybrid approach: auto-derive for tier 2 (Verifik result), explicit for tier 3-4 (requires selfie + documents).

## 14. Rollback Strategy

1. **Emergency pause**: `POST /v1/emergency/kill-switch` with `flag: "SST_API_PAUSED", enabled: true` — instantly blocks new payment intents.
2. **Pause payouts**: `flag: "SST_PAYOUTS_PAUSED"` — blocks Bre-B withdrawals.
3. **Refund in-flight**: DPO calls `POST /v1/payments/{id}/refund` for each pending tx.
4. **Mass payout**: `scripts/emergency/payout-all.ts` drains all balances to original payment method via Wompi refund.
5. **SST remove**: `sst remove --stage prod` deletes DynamoDB tables (after S3 backup).
6. **Frontend fallback**: Re-deploy Astro without `MarketCheckoutModal.tsx` — removes the pay button.
7. **Communicate**: DPO email blast via SES to all users explaining the pause.

## 15. Open Questions (for operator before apply)

1. **Wompi sandbox keys**: ready to provide?
2. **MaxMind license key**: ready, or need registration help?
3. **AbuseIPDB API key**: register yourself, or want me to set up?
4. **First tenant for staging test**: which vendor do we onboard first (Opita Code itself as dogfood)?
5. **DPO email for fraud alerts**: confirm `PTD_DPO_EMAIL` is current.
6. **Transportadora for delivery confirm**: Interrapidisimo first — can you share API docs or webhook contract?
7. **CORS origins for staging**: `market-dev.opitacode.com` (yes), `localhost:4321` (yes), anything else?

## 16. Files (full paths)

**Created (new):**
- `packages/pagos-service/` — entire package (~30 files)
- `apps/market-web/src/components/market/` — 4 React islands
- `apps/market-web/src/lib/wompi-widget.ts`, `api-client.ts`, `tier-display.ts`
- `scripts/download-geoip-databases.ts`
- `.github/workflows/deploy-backend.yml`

**Modified:**
- `package.json` (workspace dep)
- `sst.config.ts` (7 tables + Lambda Layer + PagosAPI + Router route)
- `apps/market-web/src/lib/cognito-sso-consumer.ts` (expose auth helper to pagos-service)

**Untouched (reused):**
- `packages/compliance-service/src/lib/verifik-client.ts` — imported as `@opita-market/compliance-service/lib/verifik-client`
- `packages/compliance-service/src/lib/cognito-auth.ts` — extracted to shared module if not already
- `packages/compliance-service/src/lib/audit-log-emitter.ts` — imported for `representative_consented.audit_log` writes