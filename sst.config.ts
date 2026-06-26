/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "opita-market",
      // Canonical stages: dev, prod. Do NOT use "production" — it creates a separate stack.
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
    // 1. Compliance Postgres — managed Aurora Serverless v2.
    //    Hosts the two segregated schemas (public_commercial + representative_consented)
    //    defined in packages/compliance-service/src/db/schema.sql.
    //    Credentials live in AWS Secrets Manager via `link` (never env vars).
    const db = new sst.aws.Aurora("ComplianceDb", {
      engine: "postgres",
      vpc: {
        // Default SST VPC — same pattern as opita-vibe-studio.
      },
      scaling: {
        min: 0.5,
        max: 2,
      },
      dataApi: true,
      migrations: {
        // Wired to packages/compliance-service/src/db/schema.sql.
        // SST runs this on `sst deploy` after the cluster is up.
        filePath: "./packages/compliance-service/src/db/schema.sql",
      },
    });

    // 2. Audit log cold archive bucket — receives 5y+ old audit_log rows
    //    per spec/data-protection-compliance "Audit Log Retention" requirement.
    //    Lifecycle rule added in PR 4 (SLA + Observability).
    const auditArchiveBucket = new sst.aws.Bucket("AuditArchive", {
      versioning: true,
      // Object Lock requires explicit opt-in via CLI/console; deferred to PR 5
      // for the immutable RNBD receipt artifact per design.md §"S3 cold archive".
    });

    // 3. NIT+DV verifier response cache table (DynamoDB).
    //    24h TTL attribute drives auto-cleanup; manual negative caching
    //    lives in src/api/nit-dv.ts. S3 mirror (NitDvArchive below) is
    //    wired for DPO review (longer retention).
    const nitDvCache = new sst.aws.Dynamo("NitDvCache", {
      fields: { nit_dv: "string" },
      primaryIndex: { hashKey: "nit_dv" },
      ttl: "ttl_epoch",
    });

    // 4. NIT+DV verifier response S3 mirror (DPO review, longer retention).
    const nitDvArchiveBucket = new sst.aws.Bucket("NitDvArchive");

    // 5. ComplianceAPI Lambda — Hono router mounted under api.opitacode.com.
    //    `link: [db, nitDvCache]` grants IAM permissions automatically.
    //    VERIFIK_API_KEY + JWT_SECRET are wired via SST Secret so they
    //    never appear in the Lambda env directly (avoids accidental
    //    console print in CloudWatch).
    const verifikSecret = new sst.Secret("VerifikApiKey");
    const jwtSecret = new sst.Secret("ComplianceJwtSecret");

    const complianceApi = new sst.aws.Function("ComplianceAPI", {
      handler: "packages/compliance-service/src/api/index.handler",
      link: [db, nitDvCache, auditArchiveBucket, verifikSecret, jwtSecret],
      environment: {
        // SST links the secrets above into process.env automatically
        // (named after the Secret resource). These fallbacks document the
        // expected names so devs can `sst dev` without IAM surprises.
        NIT_DV_CACHE_TABLE: nitDvCache.name,
        DPO_EMAILS: process.env.DPO_EMAILS ?? "",
      },
      timeout: "30 seconds",
      memory: "512 MB",
    });

    // 6. Router — extend api.opitacode.com so /rights/* and /verify-nit/* route
    //    to ComplianceAPI. The opita-market share is api.opitacode.com/market/*
    //    per Phase 0 v3, but for the compliance endpoints we expose them at
    //    /market/rights/* via a path-prefix (matches the operator-decided
    //    `market.opitacode.com` consumer-domain boundary).
    const router = new sst.aws.Router("MarketRouter", {
      domain: $app.stage === "prod" ? "api.opitacode.com" : "api-dev.opitacode.com",
      routes: {
        "/market/rights/*": complianceApi.url,
        "/market/verify-nit/*": complianceApi.url,
        "/market/audit": complianceApi.url,
      },
      transform: {
        cachePolicy: {
          parametersInCacheKeyAndForwardedToOrigin: {
            cookiesConfig: { cookieBehavior: "none" },
            headersConfig: {
              headerBehavior: "whitelist",
              headers: { items: ["Authorization", "Origin", "x-dpo-email"] },
            },
            queryStringsConfig: { queryStringBehavior: "all" },
          },
        },
      },
    });

    // 7. MarketWeb — public Astro 5 SSR storefront deployed to
    //    market.opitacode.com. Hosts PTD + Aviso pages and the DPO dashboard.
    //    SSR is required because the dashboard reads Astro.locals.user and
    //    fetches from the Compliance API on every request.
    //
    //    Per astro-frontend skill: uses `sst.aws.Astro` component with
    //    `responseMode: "stream"` (configured in astro.config.mjs).
    //
    //    `link: [db, auditArchiveBucket]` grants IAM permissions to read
    //    from the Aurora cluster and write cold-archive audit rows.
    //
    //    `environment.PUBLIC_API_URL` is consumed by the DPO dashboard to
    //    fetch `/market/audit` etc. from the API router above.
    const web = new sst.aws.Astro("MarketWeb", {
      path: "apps/market-web/",
      link: [db, auditArchiveBucket],
      environment: {
        PUBLIC_API_URL: router.url,
        JWT_SECRET: jwtSecret.value,
      },
      domain: $app.stage === "prod" ? "market.opitacode.com" : "market-dev.opitacode.com",
    });

    return {
      DatabaseName: db.clusterIdentifier,
      DatabaseSecretArn: db.secretArn,
      AuditArchiveBucketName: auditArchiveBucket.name,
      NitDvArchiveBucketName: nitDvArchiveBucket.name,
      NitDvCacheTableName: nitDvCache.name,
      ComplianceApiUrl: complianceApi.url,
      MarketRouterUrl: router.url,
      MarketWebUrl: web.url,
    };
  },
});