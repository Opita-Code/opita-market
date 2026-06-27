/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Opita Market — SST v4 configuration (HYBRID DEPLOY — Phase B)
 *
 * Architecture (cf-hybrid-2026-06-26):
 *   - Astro frontend (MarketWeb) → Cloudflare Pages (deploy via wrangler)
 *   - Compliance backend (Aurora + Lambda + Object Lock S3) → SST v4 (AWS)
 *
 * Why hybrid:
 *   - SST v4 is in maintenance mode (team shifted to OpenCode); bug fixes
 *     for CloudFormation churn are unlikely
 *   - Cloudflare acquired Astro Jan 2026; @astrojs/cloudflare is the
 *     blessed path going forward
 *   - Cloudflare Pages deploy is local-CPU-friendly (~30s vs 12+ min for SST)
 *   - Compliance data stays on AWS Aurora with Object Lock COMPLIANCE mode
 *     + 7y retention documented in RUNBOOK
 *
 * This file was REWRITTEN after deployment errors revealed the original sub-agent
 * output had several SST v4 syntax bugs (see RUNBOOK.md §"SST v4 fixes").
 * Now stripped of MarketWeb (moved to Cloudflare Pages) — backend only.
 */

export default $config({
  app(input) {
    return {
      name: "opita-market",
      removal: input?.stage === "prod" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
        },
      },
    };
  },
  async run() {
    // ====================================================================
    // 1. VPC — SST v4 requires explicit VPC component for Aurora.
    //    Renamed from "MarketVpc" to "MarketVpcV2" because SST 4.16 deprecated
    //    both `Vpc` (no version suffix) and `Vpc.v1` — the new pattern is to use
    //    a unique name to force the component to use the latest version.
    //    Reference: https://sst.dev/docs/components/#versioning
    // ====================================================================
    const vpc = new sst.aws.Vpc("MarketVpcV2", { nat: "managed" });

    // ====================================================================
    // 2. Aurora Postgres — managed Aurora Serverless v2.
    //    Hosts the two segregated schemas (public_commercial + representative_consented)
    //    defined in packages/compliance-service/src/db/schema.sql.
    //    dataApi=true: HTTP endpoint, no VPC peering needed for sst dev or Lambda.
    // ====================================================================
    const db = new sst.aws.Aurora("ComplianceDb", {
      engine: "postgres",
      vpc,
      scaling: { min: "0.5 ACU", max: "2 ACU" },
      dataApi: true,
      migrations: {
        filePath: "./packages/compliance-service/src/db/schema.sql",
      },
    });

    // ====================================================================
    // 3. Audit log cold archive bucket — 5y retention per Ley 1581.
    //    Uses SST v4 lifecycle format (array of rules) for expiration,
    //    plus transform.lifecycle for storage class transitions.
    // ====================================================================
    const auditArchiveBucket = new sst.aws.Bucket("AuditArchive", {
      versioning: true,
      // SST-managed lifecycle: expire objects after 5 years (1825 days)
      lifecycle: [
        { id: "expire-after-5y", expiresIn: "1825 days" },
      ],
      // AWS-provider-level lifecycle: storage class transitions
      transform: {
        lifecycle: {
          rules: [
            {
              id: "transition-to-glacier-ir-after-1y",
              status: "Enabled",
              transitions: [
                { storageClass: "GLACIER_IR", days: 365 },
              ],
            },
            {
              id: "transition-to-deep-archive-after-5y",
              status: "Enabled",
              transitions: [
                { storageClass: "DEEP_ARCHIVE", days: 1825 },
              ],
            },
          ],
        },
      },
    });

    // ====================================================================
    // 4. RNBD receipts bucket — IMMUTABLE WORM storage (7y compliance retention).
    //    Object Lock in COMPLIANCE mode via transform.bucket.
    //    Cannot be modified or deleted even by AWS root until retention elapses.
    // ====================================================================
    const rnbdReceiptsBucket = new sst.aws.Bucket("RnbdReceipts", {
      versioning: true,
      transform: {
        bucket: {
          object_lock_enabled: true,
          object_lock_configuration: {
            object_lock_enabled: "Enabled",
            rule: {
              default_retention: {
                mode: "COMPLIANCE",
                years: 7,
              },
            },
          },
        },
      },
    });

    // ====================================================================
    // 5. NIT+DV verifier response cache (DynamoDB) + S3 mirror.
    // ====================================================================
    const nitDvCache = new sst.aws.Dynamo("NitDvCache", {
      fields: { nit_dv: "string" },
      primaryIndex: { hashKey: "nit_dv" },
      ttl: "ttl_epoch",
    });

    const nitDvArchiveBucket = new sst.aws.Bucket("NitDvArchive");

    // ====================================================================
    // 6. Secrets (PR 4.5 refactor + PR 1.4 pre-deploy-remediation).
    //    Compliance: VerifikApiKey + ComplianceJwtSecret (existing).
    //    Pagos (PR 1.4): 4 Wompi keys. Migrated from plaintext root .env
    //    to AWS Secrets Manager via SST Secret. Closes OPL-IAM-003 +
    //    OPL-SECRET-001 from pentest OPL-PT-2026-06-26-001.
    //    Rotation procedure documented in RUNBOOK.md §"Rotating Wompi keys".
    // ====================================================================
    const verifikSecret = new sst.Secret("VerifikApiKey");
    const jwtSecret = new sst.Secret("ComplianceJwtSecret");
    const wompiPublicKey = new sst.Secret("WompiPublicKey");
    const wompiPrivateKey = new sst.Secret("WompiPrivateKey");
    const wompiEventsSecret = new sst.Secret("WompiEventsSecret");
    const wompiIntegritySecret = new sst.Secret("WompiIntegritySecret");

    // ====================================================================
    // 7. ComplianceAPI Lambda — Hono router with Function URL for HTTP access.
    //    url:true is MANDATORY in SST v4 (no implicit Function URL).
    //    Astro frontend (Cloudflare Pages) calls this URL via PUBLIC_API_URL.
    // ====================================================================
    const complianceApi = new sst.aws.Function("ComplianceAPI", {
      handler: "packages/compliance-service/src/api/index.handler",
      url: true,
      link: [db, nitDvCache, auditArchiveBucket, verifikSecret, jwtSecret],
      environment: {
        NIT_DV_CACHE_TABLE: nitDvCache.name,
        DPO_EMAILS: process.env.DPO_EMAILS ?? "Owner@opitacode.com",
        // SST v4 link does NOT auto-inject these as plain env vars (you'd
        // access them via Resource.X.value). We bind explicitly via
        // $interpolate so legacy handlers using process.env keep working.
        DATABASE_URL: $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${db.database}`,
        VERIFIK_API_KEY: verifikSecret.value,
        COMPLIANCE_JWT_SECRET: jwtSecret.value,
      },
      timeout: "30 seconds",
      memory: "512 MB",
    });

    // ====================================================================
    // 6b. PagosAPI DynamoDB tables (PR 1.4b — pre-deploy-remediation).
    //     Multi-table design (NOT single-table) per pentest OPL-PT-2026-06-26-001.
    //     TTL on IpGeoCache (7d) + FraudSignals (30d) + ProcessedWebhooks (7d).
    //     GSIs:
    //       - Transactions: IdempotencyKeyIndex, WompiTxIdIndex, StatusUpdatedAtIndex
    //       - Referrals: RefereeUserIdIndex (for qualifyOnAction)
    //
    //     NOTE: SST v4 aws.Dynamo requires every declared field to be in
    //     a primary or GSI index. Non-indexed fields (e.g., amount_cop,
    //     type, balance_cop) are NOT declared — they're stored as
    //     schemaless attributes via UpdateCommand.ExpressionAttributeValues.
    // ====================================================================
    const walletsTable = new sst.aws.Dynamo("WalletsTable", {
      fields: { user_id: "string" },
      primaryIndex: { hashKey: "user_id" },
    });

    const ledgerTable = new sst.aws.Dynamo("LedgerTable", {
      fields: { user_id: "string", ts_seq: "string" },
      primaryIndex: { hashKey: "user_id", rangeKey: "ts_seq" },
    });

    const transactionsTable = new sst.aws.Dynamo("TransactionsTable", {
      fields: {
        transaction_id: "string",
        idempotency_key: "string",
        wompi_tx_id: "string",
        status: "string",
        updated_at: "string",
      },
      primaryIndex: { hashKey: "transaction_id" },
      globalIndexes: {
        IdempotencyKeyIndex: { hashKey: "idempotency_key" },
        WompiTxIdIndex: { hashKey: "wompi_tx_id" },
        StatusUpdatedAtIndex: { hashKey: "status", rangeKey: "updated_at" },
      },
    });

    const referralsTable = new sst.aws.Dynamo("ReferralsTable", {
      fields: { referrer_user_id: "string", referee_user_id: "string", code: "string" },
      primaryIndex: { hashKey: "referrer_user_id", rangeKey: "referee_user_id" },
      globalIndexes: {
        RefereeUserIdIndex: { hashKey: "referee_user_id" },
        CodeIndex: { hashKey: "code" },
      },
    });

    const bonusesTable = new sst.aws.Dynamo("BonusesTable", {
      fields: { user_id: "string", rule_id: "string", transaction_id: "string" },
      primaryIndex: { hashKey: "user_id", rangeKey: "rule_id" },
      // PR 7 — TransactionIdIndex (closes OPL-CARD-014 bonus reversal flow)
      // Lookup all bonuses credited for a refunded transaction.
      // Without this GSI, refund couldn't find which bonuses to reverse.
      globalIndexes: {
        TransactionIdIndex: { hashKey: "transaction_id" },
      },
    });

    const ipGeoCacheTable = new sst.aws.Dynamo("IpGeoCacheTable", {
      fields: { ip: "string" },
      primaryIndex: { hashKey: "ip" },
      ttl: "ttl_epoch",
    });

    const fraudSignalsTable = new sst.aws.Dynamo("FraudSignalsTable", {
      fields: { signal_id: "string", user_id: "string", created_at: "string" },
      primaryIndex: { hashKey: "signal_id" },
      globalIndexes: {
        UserHistoryIndex: { hashKey: "user_id", rangeKey: "created_at" },
      },
      ttl: "ttl_epoch",
    });

    const processedWebhooksTable = new sst.aws.Dynamo("ProcessedWebhooksTable", {
      fields: { event_id: "string" },
      primaryIndex: { hashKey: "event_id" },
      ttl: "ttl_epoch",
    });

    // ====================================================================
    // PR 2c — Velocity counters + User history (closes OPL-CARD-001/007/012/013/015)
    //
    // VelocityCountersTable: TTL-based per-(BIN|IP|Device|Email) counters.
    //   pk: counter_id = `${type}:${value}` (range key: window)
    //   Counter atomically incremented via UpdateCommand ADD count :one.
    //   TTL = window + 1h (DynamoDB auto-deletes expired counters).
    //
    // UserHistoryTable: prior BLOCK lookups for repeat offenders (30d TTL).
    //   pk: user_id, range key: block_id = `${timestamp}:${uuid}` for uniqueness.
    //   If user has prior BLOCK within 30d, auto-BLOCK without re-evaluating signals.
    // ====================================================================
    const velocityCountersTable = new sst.aws.Dynamo("VelocityCountersTable", {
      fields: { counter_id: "string", window: "string" },
      primaryIndex: { hashKey: "counter_id", rangeKey: "window" },
      ttl: "ttl_epoch",
    });

    const userHistoryTable = new sst.aws.Dynamo("UserHistoryTable", {
      fields: { user_id: "string", block_id: "string" },
      primaryIndex: { hashKey: "user_id", rangeKey: "block_id" },
      ttl: "ttl_epoch",
    });

    // ====================================================================
    // PR 2d — Bonus daily counter (closes OPL-LIB-003, OPL-CARD-011)
    //
    // BonusDailyCounterTable: tracks cumulative bonus amount + claim count
    //   per (user_id, rule_id, YYYY-MM-DD-UTC). 7d TTL.
    //   pk: counter_id = `${user_id}:${rule_id}:${date}`
    //   attrs: amount_cop, claims_count
    //   Atomic ADD via UpdateCommand.
    // ====================================================================
    const bonusDailyCounterTable = new sst.aws.Dynamo("BonusDailyCounterTable", {
      fields: { counter_id: "string" },
      primaryIndex: { hashKey: "counter_id" },
      ttl: "ttl_epoch",
    });

    // ====================================================================
    // PR 2e — Referral monthly counter (closes OPL-LIB-009)
    //
    // ReferralMonthlyCounterTable: per-referrer monthly qualified count.
    //   pk: counter_id = `${referrer_user_id}:${YYYY-MM-UTC}`
    //   attrs: claims_count
    //   TTL: 35 days
    // ====================================================================
    const referralMonthlyCounterTable = new sst.aws.Dynamo("ReferralMonthlyCounterTable", {
      fields: { counter_id: "string" },
      primaryIndex: { hashKey: "counter_id" },
      ttl: "ttl_epoch",
    });

    // ====================================================================
    // PR 4a — UIAF reports store (closes OPL-COMP-015 SAR persistence)
    //
    // UiafReportsTable: SAR (Suspicious Activity Report) records.
    //   pk: sar_id
    //   TTL: 5 years (UIAF retention requirement per Circular Externa 029/2014)
    //   Immutable — operator files via UIAF portal, then updates status to FILED
    // ====================================================================
    const uiafReportsTable = new sst.aws.Dynamo("UiafReportsTable", {
      fields: { sar_id: "string" },
      primaryIndex: { hashKey: "sar_id" },
      ttl: "ttl_epoch",
    });

    // PR 4b — Compliance screening secret (CLOSES OPL-COMP-018, OPL-COMP-019)
    // Currently NOT provisioned (provider swap not committed).
    // To enable ComplyAdvantage: `npx sst secret set ComplyAdvantageApiKey <key>`
    // then uncomment the lines below + swap provider in api/index.ts.
    // const complyAdvantageApiKey = new sst.Secret("ComplyAdvantageApiKey");

    // ====================================================================
    // PR 5 — Habeas Data opposition store (closes OPL-COMP-002, OPL-COMP-021)
    //
    // HabeasDataOppositionsTable: per-user opposition requests.
    //   pk: user_id, range: request_id (sortable by date)
    //   TTL: 5 years (Ley 1581 + Decreto 1377/2013 audit retention)
    //
    // TosAcceptancesTable: per-user TOS acceptance records.
    //   pk: user_id, range: acceptance_id
    //   TTL: 5 years (Estatuto 1480 consumer protection)
    // ====================================================================
    const habeasDataOppositionsTable = new sst.aws.Dynamo("HabeasDataOppositionsTable", {
      fields: { user_id: "string", request_id: "string" },
      primaryIndex: { hashKey: "user_id", rangeKey: "request_id" },
      ttl: "ttl_epoch",
    });

    const tosAcceptancesTable = new sst.aws.Dynamo("TosAcceptancesTable", {
      fields: { user_id: "string", acceptance_id: "string" },
      primaryIndex: { hashKey: "user_id", rangeKey: "acceptance_id" },
      ttl: "ttl_epoch",
    });

    // ====================================================================
    // 6c. PagosAPI Lambda — REPLICATES ComplianceAPI architecture.
    //     Hybrid deploy: SST v4 Lambda with Function URL.
    //     Link: DDB tables + Wompi secrets + shared JWT secret.
    //     Env: feature flags (R-014 of pre-deploy-remediation) for
    //           safe rollback of the new gateways.
    //     Memory: 1024 MB (higher for HMAC SHA256 + jose JWT verify).
    //     Reserved concurrency: 10 (protects account DoS — closes OPL-IAM-005).
    //     Closes: OPL-IAM-003 (secrets), MW-FE-001 (auth gateway ready),
    //             OPL-API-006 (rate limit ready).
    // ====================================================================
    const pagosApi = new sst.aws.Function("PagosAPI", {
      handler: "packages/pagos-service/src/api/index.handler",
      url: true,
      reservedConcurrency: 10,
      link: [
        walletsTable,
        ledgerTable,
        transactionsTable,
        referralsTable,
        bonusesTable,
        ipGeoCacheTable,
        fraudSignalsTable,
        processedWebhooksTable,
        velocityCountersTable,
        userHistoryTable,
        bonusDailyCounterTable,
        referralMonthlyCounterTable,
        uiafReportsTable,
        habeasDataOppositionsTable,
        tosAcceptancesTable,
        wompiPublicKey,
        wompiPrivateKey,
        wompiEventsSecret,
        wompiIntegritySecret,
        jwtSecret, // shared with compliance-service for cross-service auth
      ],
      environment: {
        // DPO contact (used for UIAF alerts and DPO dashboard)
        DPO_EMAILS: process.env.DPO_EMAILS ?? "Owner@opitacode.com",
        // Feature flags (PR 1.4b of pre-deploy-remediation)
        // Set to "true" in production AFTER Phase 1+2 fixes are validated
        // Default "false" = use legacy per-endpoint auth (current behavior)
        AUTH_GATEWAY_ENABLED: process.env.AUTH_GATEWAY_ENABLED ?? "false",
        WEBHOOK_GATEWAY_ENABLED: process.env.WEBHOOK_GATEWAY_ENABLED ?? "false",
        TRANSACT_ENABLED: process.env.TRANSACT_ENABLED ?? "false",
        // Legacy env var bindings (for code that still reads process.env)
        // These are sourced from SST Secrets (encrypted at rest in AWS SM)
        COMPLIANCE_JWT_SECRET: jwtSecret.value,
        WOMPI_PUBLIC_KEY: wompiPublicKey.value,
        WOMPI_PRIVATE_KEY: wompiPrivateKey.value,
        WOMPI_EVENTS_SECRET: wompiEventsSecret.value,
        WOMPI_INTEGRITY_SECRET: wompiIntegritySecret.value,
      },
      timeout: "30 seconds",
      memory: "1024 MB",
    });

    // ====================================================================
    // 8. Router — REMOVED. Cloudflare handles routing via DNS.
    //    The VibeRouter conflict is no longer an issue since MarketWeb is
    //    on Cloudflare Pages (separate from VibeRouter).
    // ====================================================================
    // const router = null;  // DEFERRED — no longer needed

    // ====================================================================
    // 9. MarketWeb — MOVED to Cloudflare Pages (apps/market-web/).
    //    See apps/market-web/wrangler.toml and scripts/build.js.
    //    Astro deploys via `wrangler pages deploy` (~30s, no CloudFormation).
    // ====================================================================
    // (Removed from SST — see commit message for hybrid-architecture-2026-06-26)

    // ====================================================================
    // 10. DPO SES identity — renamed from DpoEmail to avoid collision with Secret.
    //     Production access required (SES sandbox escape).
    // ====================================================================
    const dpoSender = new sst.aws.Email("DpoSender", {
      sender: process.env.DPO_SENDER_EMAIL ?? "Owner@opitacode.com",
    });

    // ====================================================================
    // 11. SNS topic for CloudWatch alarm fan-out (reserved for future crons).
    //     Crons and alarms are DEFERRED to a follow-up PR — the SST v4 cron
    //     syntax + Lambda.metric() API has breaking changes vs SST v3 that
    //     need careful individual investigation. Smoke test does not need them.
    // ====================================================================
    const dpoAlertsTopic = new sst.aws.SnsTopic("DpoAlerts");

    // 12-14. SLA monitor, RNBD window alert, Complaint report cron functions
    // are DEFERRED to a follow-up PR. See RUNBOOK.md §"Deferred ops crons".

    // 15. CloudWatch alarms DEFERRED — depend on the missing cron functions.

    // 16. Email subscription for SNS topic.
    if (process.env.DPO_EMAIL_SUBSCRIBER) {
      dpoAlertsTopic.subscribeEmail(process.env.DPO_EMAIL_SUBSCRIBER);
    }

    return {
      DatabaseName: db.clusterIdentifier,
      DatabaseSecretArn: db.secretArn,
      AuditArchiveBucketName: auditArchiveBucket.name,
      RnbdReceiptsBucketName: rnbdReceiptsBucket.name,
      NitDvArchiveBucketName: nitDvArchiveBucket.name,
      NitDvCacheTableName: nitDvCache.name,
      ComplianceApiUrl: complianceApi.url,
      PagosApiUrl: pagosApi.url,
      WalletsTableName: walletsTable.name,
      LedgerTableName: ledgerTable.name,
      TransactionsTableName: transactionsTable.name,
      ReferralsTableName: referralsTable.name,
      BonusesTableName: bonusesTable.name,
      IpGeoCacheTableName: ipGeoCacheTable.name,
      FraudSignalsTableName: fraudSignalsTable.name,
      ProcessedWebhooksTableName: processedWebhooksTable.name,
      VelocityCountersTableName: velocityCountersTable.name,
      UserHistoryTableName: userHistoryTable.name,
      BonusDailyCounterTableName: bonusDailyCounterTable.name,
      ReferralMonthlyCounterTableName: referralMonthlyCounterTable.name,
      UiafReportsTableName: uiafReportsTable.name,
      HabeasDataOppositionsTableName: habeasDataOppositionsTable.name,
      TosAcceptancesTableName: tosAcceptancesTable.name,
      MarketWebUrl: "https://market-dev.opitacode.com (Cloudflare Pages, NOT this SST stack)",
      DpoAlertsTopicArn: dpoAlertsTopic.arn,
    };
  },
});
