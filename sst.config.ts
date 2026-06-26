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

    // 3. NIT+DV verifier response cache bucket (DynamoDB is the runtime cache;
    //    S3 mirrors for DPO review). Wired in PR 2.
    const nitDvArchiveBucket = new sst.aws.Bucket("NitDvArchive");

    return {
      DatabaseName: db.clusterIdentifier,
      DatabaseSecretArn: db.secretArn,
      AuditArchiveBucketName: auditArchiveBucket.name,
      NitDvArchiveBucketName: nitDvArchiveBucket.name,
    };
  },
});