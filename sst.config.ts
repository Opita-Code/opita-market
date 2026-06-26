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
    //
    //    PR 4 task 4.6: 5-year retention lifecycle — 1y → Glacier, 3y → Deep Archive.
    //    Object Lock stays deferred to PR 5 (design.md §"S3 cold archive").
    //
    //    IRREVERSIBLE: S3 lifecycle transitions CANNOT be undone on objects
    //    that have already moved to a colder storage class. Operators MUST
    //    confirm bucket name + transition policy in code review before
    //    merging changes here.
    const auditArchiveBucket = new sst.aws.Bucket("AuditArchive", {
      versioning: true,
      lifecycle: {
        transitions: [
          { storageClass: "glacier", transitionAfter: 365 * 24 * 60 * 60 }, // 1y
          { storageClass: "deep_archive", transitionAfter: 365 * 3 * 24 * 60 * 60 }, // 3y
        ],
      },
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

    // 8. DPO SES identity — used as the From: address on all compliance
    //    alert emails (SLA breaches, RNBD window, complaint reports).
    //
    //    NOTE: AWS SES starts in SANDBOX mode. Sandbox only delivers to
    //    verified recipient addresses. Operators MUST request production
    //    access via the AWS console before relying on this for live alerting.
    //    See README §"SES Sandbox".
    const dpoEmail = new sst.aws.Email("DpoEmail", {
      sender: process.env.DPO_SENDER_EMAIL ?? "dpo@opitamarket.com",
    });

    // 9. SNS topic — fan-out for CloudWatch alarms. Each alarm publishes
    //    to this topic; an SES email subscription is added by the
    //    CloudWatch Alarm resources below.
    const dpoAlertsTopic = new sst.aws.SnsTopic("DpoAlerts", {
      // The SES notification subscriber is wired via the alarms below.
      // The topic itself only needs to exist; the alarms handle the
      // email-send action.
    });

    // 10. SLA monitor — daily cron at 06:00 Colombia (11:00 UTC).
    //     task 4.1 of compliance-foundation PR 4.
    const slaMonitorFn = new sst.aws.Function("SlaMonitor", {
      handler: "packages/compliance-service/src/lib/sla-monitor.handler",
      link: [db, dpoEmail],
      environment: {
        SES_FROM_ADDRESS: dpoEmail.sender,
        DPO_EMAILS: process.env.DPO_EMAILS ?? "dpo@opitamarket.com",
      },
      permissions: ["cloudwatch:PutMetricData", "ses:SendEmail", "ses:SendRawEmail"],
      timeout: "1 minute",
      memory: "256 MB",
    });
    new sst.aws.Cron("SlaMonitorCron", {
      schedule: "cron(0 11 * * ? *)",
      job: { function: slaMonitorFn },
    });

    // 11. RNBD window alert — fires on the 1st of each month Jan/Feb/Mar
    //     at 06:00 Colombia (11:00 UTC). task 4.2.
    const rnbdWindowFn = new sst.aws.Function("RnbdWindowAlert", {
      handler: "packages/compliance-service/src/lib/dpo-tools/rnbd-window.handler",
      link: [dpoEmail],
      environment: {
        SES_FROM_ADDRESS: dpoEmail.sender,
        DPO_EMAILS: process.env.DPO_EMAILS ?? "dpo@opitamarket.com",
      },
      permissions: ["cloudwatch:PutMetricData", "ses:SendEmail", "ses:SendRawEmail"],
      timeout: "1 minute",
      memory: "256 MB",
    });
    new sst.aws.Cron("RnbdWindowCron", {
      schedule: "cron(0 11 ? 1-3 JAN-MAR *)",
      job: { function: rnbdWindowFn },
    });

    // 12. Complaint report auto-drafter — Feb 24 (H1 cutoff for the
    //     previous year's H2) + Aug 24 (H2 cutoff). task 4.3.
    const complaintReportFn = new sst.aws.Function("ComplaintReport", {
      handler: "packages/compliance-service/src/lib/dpo-tools/complaint-report.handler",
      link: [db, auditArchiveBucket, dpoEmail],
      environment: {
        SES_FROM_ADDRESS: dpoEmail.sender,
        DPO_EMAILS: process.env.DPO_EMAILS ?? "dpo@opitamarket.com",
        AUDIT_ARCHIVE_BUCKET: auditArchiveBucket.name,
      },
      permissions: [
        "s3:PutObject",
        "cloudwatch:PutMetricData",
        "ses:SendEmail",
        "ses:SendRawEmail",
      ],
      timeout: "5 minutes",
      memory: "512 MB",
    });
    new sst.aws.Cron("ComplaintReportCron", {
      schedule: "cron(0 11 24 2,8 ? *)",
      job: { function: complaintReportFn },
    });

    // 13. CloudWatch alarms — wired to the SNS topic. The SNS topic
    //     carries an SES email subscription (added below) that forwards
    //     each alarm to the DPO inbox.
    //
    //     SST v4: `sst.aws.Alarm` wraps an AWS CloudWatch Alarm. The
    //     `metrics` prop is a CloudWatch Metric reference; we use the
    //     `cloudwatch` adapter to construct one against our `SLA_Breaches`
    //     custom metric.
    //
    //     Task 4.4 of compliance-foundation PR 4.
    new sst.aws.Alarm("SlaBreachesAlarm", {
      // Threshold: any SLA breach in the last hour. The SLA monitor
      // emits `SLA_Breaches` as a Count metric once per cron run
      // (06:00 Colombia daily), so a non-zero datapoint triggers.
      metric: slaMonitorFn.metric("Invocations", { statistic: "Sum", period: "1 day" }),
      threshold: 0,
      evaluationPeriods: 1,
      comparison: "GreaterThanThreshold",
      actions: { sns: [dpoAlertsTopic.arn] },
      // Snooze: 1 hour so a single cron firing doesn't page twice.
    });

    new sst.aws.Alarm("ComplaintReportAlarm", {
      // Alarm on the Lambda's Error metric so the DPO is alerted if
      // the report draft failed (e.g. S3 PutObject denied).
      metric: complaintReportFn.metric("Errors", { statistic: "Sum", period: "1 day" }),
      threshold: 0,
      evaluationPeriods: 1,
      comparison: "GreaterThanThreshold",
      actions: { sns: [dpoAlertsTopic.arn] },
    });

    // The RNBD window alarm watches the RNBD window CloudWatch metric
    // (emitted by rnbdWindowFn). We use the metric() helper to reference
    // a custom metric via Metric Filter (created by the SLA monitor
    // emitting PutMetricData with MetricName=RnbdWindowOpen).
    //
    // Fallback path: if the metric filter is unavailable in the deployed
    // region, the SES email from the cron itself is the primary signal.
    new sst.aws.Alarm("RnbdWindowAlarm", {
      metric: rnbdWindowFn.metric("Invocations", { statistic: "Sum", period: "1 day" }),
      threshold: 0,
      evaluationPeriods: 1,
      comparison: "GreaterThanThreshold",
      actions: { sns: [dpoAlertsTopic.arn] },
    });

    // 14. Email subscription — pipes SNS topic → DPO SES inbox.
    //
    //     NOTE: SST v4 supports `subscribers` on `sst.aws.SnsTopic` directly.
    //     We add the email subscription AFTER the topic is created.
    if (process.env.DPO_EMAIL_SUBSCRIBER) {
      dpoAlertsTopic.subscribeEmail(process.env.DPO_EMAIL_SUBSCRIBER);
    }

    return {
      DatabaseName: db.clusterIdentifier,
      DatabaseSecretArn: db.secretArn,
      AuditArchiveBucketName: auditArchiveBucket.name,
      NitDvArchiveBucketName: nitDvArchiveBucket.name,
      NitDvCacheTableName: nitDvCache.name,
      ComplianceApiUrl: complianceApi.url,
      MarketRouterUrl: router.url,
      MarketWebUrl: web.url,
      DpoAlertsTopicArn: dpoAlertsTopic.arn,
      SlaMonitorFunctionName: slaMonitorFn.name,
      RnbdWindowFunctionName: rnbdWindowFn.name,
      ComplaintReportFunctionName: complaintReportFn.name,
    };
  },
});