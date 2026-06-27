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
      MarketWebUrl: "https://market-dev.opitacode.com (Cloudflare Pages, NOT this SST stack)",
      DpoAlertsTopicArn: dpoAlertsTopic.arn,
    };
  },
});
