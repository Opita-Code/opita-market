# Remediation Checklist — opita-pagos-foundation

**Para:** Developer
**Origen:** Pentest pre-deploy OPL-PT-2026-06-26-001
**Total items:** 87
**Production-blockers (Phase 1):** 22
**Estimated effort:** ~132 hours total (Phase 1: 40h, Phase 2: 32h, Phase 3: 60h, Phase 4: ongoing)

**Convención de checkboxes:**
- `[ ]` = pendiente
- `[x]` = completado
- `[~]` = en progreso
- `[!]` = bloqueado (explicar abajo)

---

## 🔴 PHASE 1 — Production Blockers (Hacer antes de cualquier deploy)

### Authentication & Secrets

- [ ] **OPL-LIB-005** (CRITICAL) — Reemplazar `process.env.NODE_ENV !== 'production'` con `process.env.DEV_AUTH_ENABLED === 'true'` en `packages/pagos-service/src/lib/auth.ts:73-84`
  - Effort: 15 min
  - Test: agregar test que verifica que con NODE_ENV undefined, dev-user NO se acepta
  - Acceptance: 100% de los tests pasan + nuevo test verde

- [ ] **MW-FE-003** (CRITICAL) — Mismo fix en `apps/market-web/src/lib/cognito-sso-consumer.ts:84-101`
  - Effort: 15 min
  - Test: agregar test que verifica que con JWT_SECRET set y NODE_ENV undefined, dev bypass no se activa
  - Acceptance: 100% de los tests pasan

- [ ] **MW-FE-001** (CRITICAL) — Mover JWT_SECRET a Cloudflare Pages runtime env (no build-time)
  - Effort: 1h
  - Steps:
    1. Renombrar `PUBLIC_JWT_SECRET` → `JWT_SECRET` en `.env.local` (sin prefijo PUBLIC_)
    2. Quitar `JWT_SECRET` de `env.d.ts` (no exponer a ImportMetaEnv)
    3. En Cloudflare Pages: Settings → Environment Variables → Add `JWT_SECRET` (production)
    4. En `cognito-sso-consumer.ts`: cambiar `process.env.JWT_SECRET` → `globalThis.env.JWT_SECRET ?? Astro.locals.runtime.env.JWT_SECRET`
    5. Verificar que el bundle compilado NO contiene el valor (grep en `dist/`)
  - Test: build → `grep -r JWT_SECRET dist/` debe retornar vacío
  - Acceptance: bundle limpio + test verde

- [ ] **OPL-IAM-003 + OPL-SECRET-001** (CRITICAL) — Mover Wompi keys a SST Secrets
  - Effort: 2h
  - Steps:
    1. En `sst.config.ts`: `const wompiPrivKey = new sst.Secret("WompiPrivateKey")` (igual para Pub, Events, Integrity)
    2. En Lambda handler: `Resource.WompiPrivateKey.value` en lugar de `process.env.WO_PRIV_KEY`
    3. Deploy a dev, verificar que SST crea los secrets en AWS Secrets Manager
    4. Rotar la Wompi priv key actual (ya está expuesta en .env, así que rotar es obligatorio)
    5. Documentar el procedimiento de rotación en RUNBOOK.md
  - Test: deploy → verificar que `aws secretsmanager list-secrets` muestra los 4 Wompi secrets
  - Acceptance: keys en Secrets Manager + .env sin secrets de Wompi

### Webhook Security

- [ ] **OPL-LIB-001** (CRITICAL) — Agregar timestamp validation en `verifyWebhookSignature`
  - Effort: 5 min
  - Code:
    ```typescript
    const MAX_AGE_MS = 5 * 60 * 1000;
    const webhookTime = body.timestamp * 1000; // Wompi sends seconds
    if (Math.abs(Date.now() - webhookTime) > MAX_AGE_MS) {
      throw new InvalidSignatureError();
    }
    ```
  - Test: webhook con timestamp = 1 hora atrás → rechaza
  - Acceptance: test verde

- [ ] **OPL-CARD-002** (CRITICAL) — Implementar webhook full state machine + 3DS verification
  - Effort: 8h
  - Steps:
    1. Parse `body.event` (transaction.approved, .declined, .reversed, .disputed)
    2. Para `transaction.approved`: 
       - Verificar 3DS si `transaction.requires_3ds === true` (llamar a Wompi API GET /transactions/{id})
       - Llamar `EscrowStateMachine.transition(tx, 'WOMPI_APPROVED')`
       - Si `escrow_state === 'NONE'` → credit wallet vía `CreditWalletUseCase`
       - Si `escrow_state === 'HELD'` → no credit (ya está en escrow, esperar delivery confirm)
    3. Para `transaction.declined`: marcar tx como FAILED en DynamoDB
    4. Para `transaction.reversed`: llamar `reverseBonusesForTransaction(tx.id)`
    5. Idempotency: lookup en `ProcessedWebhooks` table por `event.id`, si existe → 200 (idempotent retry)
  - Test: 6 tests nuevos cubriendo cada event type
  - Acceptance: webhook funcional + 3DS verificado + idempotent

- [ ] **OPL-API-002** (CRITICAL) — HMAC signature para delivery webhook
  - Effort: 4h
  - Steps:
    1. Definir transportadora secret (separado de Wompi events secret)
    2. En `api/delivery.ts:11-77`: implementar `verifyTransportadoraSignature(signature, body, secret)` con `crypto.timingSafeEqual`
    3. Validar que la transportadora está autorizada para el `transaction_id` específico (lookup en `logistics` table)
    4. Documentar el contrato con la transportadora (header `x-transportadora-signature` = HMAC SHA256)
  - Test: request sin signature → 401; con signature inválida → 401; con signature válida pero transportadora no autorizada → 403
  - Acceptance: 3 tests verdes

- [ ] **OPL-API-004** (CRITICAL) — Webhook idempotency
  - Effort: 4h (incluido en OPL-CARD-002)
  - Steps:
    1. Crear tabla `ProcessedWebhooks` (pk: event_id, ttl: 7 días)
    2. En webhook handler: lookup event_id, si existe → return 200 sin procesar
    3. Si no existe: PutItem con ConditionExpression `attribute_not_exists(event_id)`, capturar `ConditionalCheckFailedException` → return 200 (idempotent)
  - Test: enviar mismo webhook 2 veces → solo 1 vez se procesa
  - Acceptance: test verde

### Financial Logic

- [ ] **OPL-API-001 + OPL-CARD-003** (CRITICAL) — P2P transfer con TransactWriteItems
  - Effort: 4h
  - Code:
    ```typescript
    await dynamoClient.send(new TransactWriteCommand({
      TransactItems: [
        { Update: { TableName: wallets, Key: { user_id: from }, UpdateExpression: 'SET balance_cop = balance_cop - :amt, version = version + 1', ConditionExpression: 'balance_cop >= :amt', ExpressionAttributeValues: { ':amt': amount } } },
        { Update: { TableName: wallets, Key: { user_id: to }, UpdateExpression: 'SET balance_cop = if_not_exists(balance_cop, :zero) + :amt, version = version + 1', ExpressionAttributeValues: { ':amt': amount, ':zero': 0 } } }
      ]
    }));
    ```
  - Test: simular fallo en la 2da operación → verificar que la 1ra también se rollbackea
  - Acceptance: 2 tests verdes (happy path + failure path)

- [ ] **OPL-LIB-002** (CRITICAL) — Eliminar TOCTOU en DebitWalletUseCase
  - Effort: 4h
  - Steps:
    1. Reemplazar el GET + check + UpdateCommand con un solo UpdateCommand atómico
    2. Code:
      ```typescript
      await dynamoClient.send(new UpdateCommand({
        TableName: wallets, Key: { user_id: input.userId },
        UpdateExpression: 'SET balance_cop = balance_cop - :amt, version = version + :one, updated_at = :now',
        ConditionExpression: 'balance_cop >= :amt',
        ExpressionAttributeValues: { ':amt': input.amountCop, ':one': 1, ':now': new Date().toISOString() }
      }));
      ```
    3. Catch `ConditionalCheckFailedException` → throw `InsufficientBalanceError` con mensaje genérico (no leak balance)
  - Test: 2 requests concurrentes con mismo balance → solo 1 succeeds
  - Acceptance: test verde

- [ ] **OPL-API-011** (CRITICAL) — Use DebitWalletUseCase en withdraw endpoint
  - Effort: 1h
  - Steps: en `api/wallet.ts:84-146`, reemplazar el GET+check manual con una llamada a `DebitWalletUseCase.execute({ userId, amountCop: amount })`
  - Test: 2 requests concurrentes del mismo usuario por el total → solo 1 succeeds
  - Acceptance: test verde

- [ ] **OPL-LIB-003** (CRITICAL) — Per-user daily bonus cap
  - Effort: 2h
  - Steps:
    1. Agregar `maxAmountPerDayCop: 100_000` y `maxClaimsPerDay: 20` a `PURCHASE_CASHBACK` y `FIRST_PURCHASE_CASHBACK` en `bonus-rules.ts`
    2. En `BonusStore`: agregar `getDailyBonusTotal(userId, ruleId, day): Promise<{amountCop, claimCount}>`
    3. En `BonusEngine.triggerRule`: antes de aplicar, verificar cap
  - Test: 21 transacciones de $5k en 1 día → 21ª es rechazada
  - Acceptance: test verde

- [ ] **OPL-CARD-001** (CRITICAL) — Velocity controls en runFraudChecks
  - Effort: 8h
  - Steps:
    1. Agregar tabla `VelocityCounters` (pk: counter_id = `${type}:${value}:${window}`, ttl: ventana + 1h)
    2. Tipos: BIN_CARD, IP_CARD, DEVICE_CARD, EMAIL_INTENT
    3. En `runFraudChecks`: hacer 4 UpdateCommand atómicos (increment + check threshold)
    4. Si threshold excedido: emitir `VELOCITY_EXCEEDED` signal (weight 0.6)
  - Test: 11 requests con mismo BIN en 1 min → 11ª dispara VELOCITY_EXCEEDED
  - Acceptance: 4 tests verdes (uno por tipo)

### Compliance

- [ ] **OPL-COMP-006** (CRITICAL) — SIC registration para closed-loop wallet
  - Effort: days-weeks (regulatory)
  - Steps:
    1. Contactar SIC para iniciar proceso de registro
    2. Preparar documentación: reglamento de la wallet, políticas de seguridad, modelo de riesgos
    3. Submit application
    4. Guardar certificado de registro en S3 bucket WORM-protected
  - Acceptance: certificado de registro archivado

- [ ] **OPL-COMP-014** (CRITICAL) — Wire UIAF monitor
  - Effort: 8h
  - Steps:
    1. En `sst.config.ts`: agregar EventBridge schedule `rate(1 hour)` que invoca el Lambda
    2. En `crons/uiaf-monitor.ts`: implementar `run()` que llama `UiafMonitor.checkTransactions()`
    3. Verificar que el SES alerter envía al DPO email real
    4. Implementar 10M threshold para non-cash (WOMPI_PSE, WOMPI_NEQUI, WOMPI_DAVIPLATA) [OPL-COMP-017]
    5. Agregar structuring detection: 5+ transactions de 900k-1M COP del mismo user en 24h [OPL-COMP-016]
  - Test: insertar transacción sintética de 6M COP → monitor detecta y aleta
  - Acceptance: test verde + cron deployed

- [ ] **OPL-COMP-018** (CRITICAL) — PEP screening
  - Effort: $$$$ (external service)
  - Steps:
    1. Evaluar providers: ComplyAdvantage, Refinitiv, Dow Jones
    2. Integrar en onboarding flow
    3. Implementar enhanced due diligence para matches
  - Acceptance: provider integrado + screening en onboarding

- [ ] **OPL-COMP-019** (CRITICAL) — Sanctions screening (OFAC/UN/EU)
  - Effort: $$$$ (external service)
  - Steps:
    1. Usar OFAC SDN, UN Security Council, EU Consolidated List
    2. Provider sugerido: Dow Jones Watchlist, Refinitiv World-Check
    3. Screen en onboarding + transacciones > 1M COP
  - Acceptance: provider integrado + screening

### SSRF & Validation

- [ ] **OPL-LIB-004** (CRITICAL) — SSRF validation en evidence photo_url
  - Effort: 2h
  - Code:
    ```typescript
    const isSafeUrl = (url: string): boolean => {
      try {
        const parsed = new URL(url);
        const blocked = ['169.254.169.254', '169.254.169.249', '169.254.169.123', 'metadata.google.internal', '100.100.100.200'];
        return parsed.protocol === 'https:' && !blocked.includes(parsed.hostname.toLowerCase());
      } catch { return false; }
    };
    if (evidence.photo_url && !isSafeUrl(evidence.photo_url)) {
      return { ...tx, error: 'EVIDENCE_URL_INVALID' };
    }
    ```
  - Test: photo_url = `http://169.254.169.254/...` → EVIDENCE_URL_INVALID
  - Acceptance: 3 tests verdes (block IMDS, block non-HTTPS, accept valid)

### Frontend Security

- [ ] **MW-FE-002** (CRITICAL) — Wompi widget SRI
  - Effort: 1h
  - Steps:
    1. Solicitar a Wompi el SRI hash oficial para `widget.js`
    2. Agregar `WOMPI_WIDGET_SRI` a env vars
    3. En `wompi-widget.ts:34-46`: agregar `script.integrity = WOMPI_WIDGET_SRI; script.crossOrigin = 'anonymous';`
  - Test: build → verificar que el HTML contiene `integrity="sha384-..."`
  - Acceptance: visual verification + Wompi functional test

### Operational

- [ ] **OPL-IAM-005** (HIGH pero crítico) — Reserved concurrency
  - Effort: 1h
  - Steps: en `sst.config.ts`: `pagosFunction: { ..., reservedConcurrentExecutions: 10 }` para cada Lambda
  - Test: deploy → verificar en AWS Console que las funciones tienen reserved concurrency
  - Acceptance: CloudWatch metric `ConcurrentExecutions` < 10 sostenido

- [ ] **Astro upgrade** (CVE-2025-66202) — Upgrade a 5.15.8+
  - Effort: 1h
  - Steps: `npm install astro@^5.15.8` en market-web + tests pasan
  - Acceptance: `npm audit` no muestra CVE-2025-66202

- [ ] **CloudWatch alarms** (operational) — 7 alarms básicos
  - Effort: 4h
  - Steps: en `sst.config.ts`, agregar a `aws.cloudwatch.MetricAlarm`:
    1. Lambda errors > 1% in 5min
    2. Lambda throttles > 0
    3. DynamoDB throttles > 0
    4. API Gateway 5xx > 1% in 5min
    5. **Webhook signature failures > 10/min** (security signal — PAGER)
    6. **Fraud BLOCK rate > 50%/h** (fraud signal)
    7. Failed login > 100/min
  - Acceptance: 7 alarms deployed + tested with synthetic metric

- [ ] **CORS + security headers** (MEDIUM) — En `api/index.ts`
  - Effort: 1h
  - Steps: agregar middleware con:
    - `Access-Control-Allow-Origin: ${allowedOrigins}` (no `*`)
    - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: DENY`
    - `Referrer-Policy: no-referrer`
  - Acceptance: headers presentes en todas las responses

### Race Conditions & Atomicity

- [ ] **OPL-LIB-008 + OPL-CARD-019** (HIGH pero crítico) — FIRST_PURCHASE bonus atomic
  - Effort: 2h
  - Steps: en `BonusStore.recordBonus`, usar `ConditionExpression: "attribute_not_exists(user_id) AND attribute_not_exists(rule_id)"`. Si falla → throw.
  - Test: 2 concurrent first purchases → solo 1 bonus applied
  - Acceptance: test verde

- [ ] **OPL-CARD-006** (HIGH) — Clock injection removal
  - Effort: 30 min
  - Steps: eliminar `contextTs` de `TriggerRuleInput`. Usar solo `this.now()` (clock inyectado via DI en tests, no en API).
  - Test: triggerRule con contextTs far future → no bypass
  - Acceptance: test verde

### JWT Validation

- [ ] **MW-FE-006** (HIGH pero crítico) — JWT audience validation
  - Effort: 15 min
  - Steps: en `cognito-sso-consumer.ts:118-132`: `await jwtVerify(token, getSecret(), { algorithms: ['HS256'], audience: 'market.opitacode.com', issuer: 'cuenta.opitacode.com' })`
  - Test: JWT con aud incorrecto → rejected
  - Acceptance: test verde

---

## 🟡 PHASE 2 — First Sprint (5 días, ~32 horas)

22 HIGH findings. Items clave:

- [ ] **OPL-API-003** (HIGH) — Eliminar `from_user_id` del body, derivar siempre del JWT
  - Effort: 1h

- [ ] **OPL-API-005** (HIGH) — Validar `to_user_id` existe y no es self
  - Effort: 2h

- [ ] **OPL-API-006** (HIGH) — Rate limiting con WAF o middleware
  - Effort: 4h

- [ ] **MW-FE-004** (HIGH) — CSRF token en state-mutating requests
  - Effort: 4h

- [ ] **MW-FE-005** (HIGH) — CSP + security headers en middleware.ts
  - Effort: 2h

- [ ] **MW-FE-007** (HIGH) — Phone format validation client + server
  - Effort: 1h

- [ ] **MW-FE-008** (HIGH) — Mover DPO_EMAIL a runtime env (no bundle)
  - Effort: 1h

- [ ] **MW-FE-009** (HIGH) — Escape key + focus trap en MarketCheckoutModal
  - Effort: 2h

- [ ] **OPL-LIB-006** (HIGH) — No leak balance en InsufficientBalanceError
  - Effort: 30 min

- [ ] **OPL-LIB-007** (HIGH) — Generic messages en InvalidSignatureError
  - Effort: 30 min

- [ ] **OPL-LIB-009** (HIGH) — Per-user monthly referral cap
  - Effort: 2h

- [ ] **OPL-CARD-004** (HIGH) — 3DS verification en webhook (parte de OPL-CARD-002)
  - Effort: incluido en OPL-CARD-002

- [ ] **OPL-CARD-005** (HIGH) — PURCHASE_CASHBACK cooldown (parte de OPL-LIB-003)
  - Effort: incluido en OPL-LIB-003

- [ ] **OPL-CARD-007** (HIGH) — Fraud engine normalize (max signal contribution)
  - Effort: 4h

- [ ] **OPL-COMP-001** (HIGH) — Asignar DPO phone + actualizar PTD
  - Effort: 1h

- [ ] **OPL-COMP-007** (HIGH) — Cap Tier 4 withdrawals según Decreto 222
  - Effort: 1h (legal review needed)

- [ ] **OPL-COMP-010** (HIGH) — Crear Terms of Service page
  - Effort: 4h (legal review + content)

- [ ] **OPL-COMP-011** (HIGH) — Mostrar Wompi fees en checkout
  - Effort: 2h

- [ ] **OPL-COMP-015** (HIGH) — SAR filing a UIAF (regulatory API)
  - Effort: $$$$ (depends on UIAF API access)

- [ ] **OPL-COMP-016** (HIGH) — Structuring detection (parte de OPL-COMP-014)
  - Effort: incluido en OPL-COMP-014

- [ ] **OPL-COMP-017** (HIGH) — 10M threshold non-cash (parte de OPL-COMP-014)
  - Effort: incluido en OPL-COMP-014

- [ ] **OPL-COMP-020** (HIGH) — Hidden fees disclosure (parte de OPL-COMP-011)
  - Effort: incluido en OPL-COMP-011

---

## 🟢 PHASE 3 — First Month (3 semanas, ~60 horas)

42 MEDIUM + LOW findings. Items clave:

### API & Backend
- [ ] OPL-API-007 — Body size limit (DoS prevention)
- [ ] OPL-API-008 — No security headers (subset of CORS+headers in Phase 1)
- [ ] OPL-API-009 — Webhook retry storm protection
- [ ] OPL-API-010 — Bonus trigger ownership verification
- [ ] OPL-API-012 — Wompi IP allowlist (verify with Wompi docs first)
- [ ] OPL-API-013 — CORS configuration (subset of Phase 1)
- [ ] OPL-API-014 — Health endpoint minimal info
- [ ] OPL-API-015 — Webhook event type differentiation (subset of OPL-CARD-002)

### Lib
- [ ] OPL-LIB-010 — IP-API 429 graceful degradation
- [ ] OPL-LIB-011 — JWT structural validation
- [ ] OPL-LIB-012 — Escrow state machine distributed lock
- [ ] OPL-LIB-013 — Referral store DynamoDB query (CRITICAL — already in Phase 1)
- [ ] OPL-LIB-014 — IP2Proxy health check
- [ ] OPL-LIB-015 — Wompi signature Buffer consistency

### Carding Deep
- [ ] OPL-CARD-008 — Withdraw hold per-deposit (not aggregate)
- [ ] OPL-CARD-010 — Anti-fraud context required
- [ ] OPL-CARD-011 — Daily bonus cap (subset of OPL-LIB-003)
- [ ] OPL-CARD-012 — Fraud user history
- [ ] OPL-CARD-013 — Device fingerprint collection (new SDK)
- [ ] OPL-CARD-014 — Refund endpoint full implementation (Wompi API + reverse bonuses)
- [ ] OPL-CARD-015 — IP velocity counter
- [ ] OPL-CARD-016 — Tier 1 3DS structuring detection
- [ ] OPL-CARD-017 — Referral DynamoDB store (CRITICAL — already in Phase 1)
- [ ] OPL-CARD-018 — Rate limit on intent (subset of OPL-API-006)
- [ ] OPL-CARD-020 — 1:1 oracle + reconciliation job

### Frontend
- [ ] MW-FE-010 — X-Frame-Options
- [ ] MW-FE-011 — Idempotency key fresh per modal open
- [ ] MW-FE-012 — JWT_SECRET lazy access
- [ ] MW-FE-013 — Error code sanitization
- [ ] MW-FE-014 — Clipboard HTTP fallback
- [ ] MW-FE-015 — Remove Astro.generator meta

### Operational
- [ ] OPL-IAM-002 — Restrict CloudWatch logs to specific log group
- [ ] OPL-IAM-004 — Define cron IAM roles (least privilege)
- [ ] OPL-IAM-005 — Provisioned concurrency for critical path
- [ ] WAF attachment
- [ ] CloudFront in front
- [ ] X-Ray tracing
- [ ] Structured JSON logging
- [ ] DynamoDB auto-scaling
- [ ] On-demand backup
- [ ] DR plan documented

---

## 🔵 PHASE 4 — Compliance (paralelo, ongoing)

22 compliance findings. Items críticos:

- [ ] **OPL-COMP-002** (MEDIUM) — Opposition (oposición) REST endpoint
  - Effort: 1 día

- [ ] **OPL-COMP-003** (MEDIUM) — Age verification + parental consent
  - Effort: 1 semana (UX + legal)

- [ ] **OPL-COMP-004** (LOW) — Aviso de Privacidad retention + DPO contact
  - Effort: 2h

- [ ] **OPL-COMP-005** (LOW) — TTL retention documented in PTD
  - Effort: 1h

- [ ] **OPL-COMP-008** (MEDIUM) — 5 business day cooling-off period
  - Effort: 3 días (UX + state machine)

- [ ] **OPL-COMP-009** (LOW) — Refund policy published
  - Effort: 4h (legal content + page)

- [ ] **OPL-COMP-012** (MEDIUM) — Contract formation clause
  - Effort: 2h

- [ ] **OPL-COMP-013** (LOW) — Libro de quejas link in footer
  - Effort: 30 min

- [ ] **OPL-COMP-021** (LOW) — TOS acceptance checkbox
  - Effort: 2h

- [ ] **OPL-COMP-022** (LOW) — Cancellation button post-payment
  - Effort: 1 día (state machine + UX)

---

## 📋 Tracking & Verification

### Definition of Done (per item)

Cada item se considera completado cuando:

1. El código está escrito
2. El test correspondiente está agregado y pasa
3. El test de regresión (no romper lo que ya funcionaba) pasa
4. La cobertura de tests se mantiene ≥ 90%
5. El commit incluye referencia al finding ID (e.g., `fix: OPL-LIB-005 — fail-closed dev auth bypass`)
6. Se ha revisado contra OWASP/CWE/MITRE para confirmar que la remediación cierra el vector

### Pre-Re-Pentest Checklist

Antes de solicitar re-pentest, todos los Phase 1 items deben estar `[x]`:

- [ ] Todos los 22 production-blockers cerrados
- [ ] Tests pasando (≥ 90% coverage)
- [ ] Code review de las remediaciones (peer review)
- [ ] Verificación manual de los CVSS vectors (re-correr la exploit chain)
- [ ] No nuevas regresiones introducidas

### Post-Phase 1 → Phase 2

Una vez Phase 1 cerrado:

1. Solicitar **re-pentest focalizado** (2-3 días) — verificar cierre correcto
2. **Deploy a dev** (PR 8) — pentest dinámico del Lambda
3. **Smoke test** contra dev URL
4. Continuar con Phase 2 (HIGH findings)
5. **External audit** (auditor humano independiente) — opcional pero recomendado para producción real

### Post-Phase 2 → Phase 3

Una vez Phase 2 cerrado:

1. Re-pentest (2 días)
2. Continuar con Phase 3 (MEDIUM/LOW)
3. **Compliance legal review final** (SIC, UIAF)
4. **DPO sign-off** requerido

### Pre-Production Go-Live

Antes de producción con dinero real:

- [ ] Phase 1 + 2 + 3 cerradas
- [ ] Phase 4 con visto bueno legal
- [ ] Re-pentest focalizado verde
- [ ] Auditor externo (opcional pero muy recomendado)
- [ ] Insurance cyber-security contratado
- [ ] Incident response plan documentado
- [ ] On-call rotation definida
- [ ] DPO approval explícito

---

## 🔄 Tracking en dark-mem

Cada item cerrado se guarda como observation en dark-mem para audit trail:

```typescript
mem_save({
  title: `Fixed OPL-LIB-005: fail-closed dev auth bypass`,
  type: "bugfix",
  topic_key: "pentest/opita-pagos-foundation/fixes/OPL-LIB-005",
  content: {
    finding_id: "OPL-LIB-005",
    severity: "CRITICAL",
    file: "packages/pagos-service/src/lib/auth.ts",
    line_range: [73, 84],
    commit_sha: "...",
    test_added: true,
    verified_by: "self + dark-pentester-webapp re-test",
    closed_at: "2026-06-XX"
  }
});
```

Esto permite:
- Auditoría completa de qué se cerró, cuándo, y cómo
- Baseline para futuros deploys
- Búsqueda rápida en próximos pentests

---

**Última actualización:** 2026-06-26
**Próxima revisión:** post-Phase 1 (remediation sprint)
**Mantenedor:** dev team
