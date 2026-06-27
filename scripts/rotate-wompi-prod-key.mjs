#!/usr/bin/env node
/**
 * Wompi prod key rotation helper.
 *
 * Closes operator action #1 from PR 3 follow-ups.
 *
 * WHAT THIS SCRIPT DOES:
 *   1. Reads a NEW Wompi private key from the operator (passed via stdin
 *      or env var WOMPI_NEW_PRIVATE_KEY).
 *   2. Updates AWS Secrets Manager secret opita-market-dev-WompiPrivateKey
 *      with the new value (replaces the leaked prv_prod_5BW7fTritUEM64TqM0NwX2SgJWxo5Bkv).
 *   3. Verifies the rotation worked (re-reads the secret and compares
 *      sha256 fingerprint to confirm change).
 *   4. Optionally triggers `npx sst deploy` to pick up the new value.
 *
 * USAGE:
 *   # Option A: read from env var (recommended — uses vault.ps1 exec)
 *   $env:WOMPI_NEW_PRIVATE_KEY = & vault.ps1 exec wompi_new_private_key { Write-Output $env:SECRET }
 *   node scripts/rotate-wompi-prod-key.mjs
 *
 *   # Option B: read from stdin (paste key, Ctrl-D / Ctrl-Z to end)
 *   node scripts/rotate-wompi-prod-key.mjs --stdin
 *
 *   # Option C: dry-run (verify access without changing anything)
 *   node scripts/rotate-wompi-prod-key.mjs --dry-run
 *
 * SAFETY:
 *   - Never logs the plaintext key.
 *   - SHA-256 fingerprint shown only for verification.
 *   - Requires AWS profile 'opita-cicd' (or AWS_PROFILE env var).
 */

import { SecretsManagerClient, PutSecretValueCommand, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const STAGE = process.env.SST_STAGE || "dev";
const SECRET_NAME = `opita-market-${STAGE}-WompiPrivateKey`;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function fingerprint(label, s) {
  return `${label}=sha256:${sha256(s)} (len=${s.length})`;
}

async function readNewKey() {
  if (process.env.WOMPI_NEW_PRIVATE_KEY) {
    return process.env.WOMPI_NEW_PRIVATE_KEY.trim();
  }
  if (process.argv.includes("--stdin")) {
    return readFileSync(0, "utf8").trim();
  }
  if (process.argv.includes("--dry-run")) {
    return null;
  }
  console.error(
    "ERROR: no new key provided.\n" +
    "Set env var WOMPI_NEW_PRIVATE_KEY, pass --stdin, or use --dry-run.",
  );
  process.exit(1);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const client = new SecretsManagerClient({ region: AWS_REGION });

  console.log(`[rotate-wompi] target secret: ${SECRET_NAME}`);
  console.log(`[rotate-wompi] AWS region:    ${AWS_REGION}`);

  // Read current value for fingerprint comparison (NOT logged in plaintext)
  const current = await client.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME }),
  );
  const currentPlaintext = current.SecretString ?? "";
  console.log(
    `[rotate-wompi] current ${fingerprint("current", currentPlaintext)}`,
  );

  if (dryRun) {
    console.log("[rotate-wompi] DRY RUN — no changes made.");
    console.log(
      "[rotate-wompi] next: set WOMPI_NEW_PRIVATE_KEY env var and re-run.",
    );
    return;
  }

  // Read new key
  const newKey = await readNewKey();
  if (newKey.length < 30) {
    console.error("ERROR: new key looks too short (<30 chars). Aborting.");
    process.exit(1);
  }
  if (newKey === currentPlaintext) {
    console.error(
      "ERROR: new key matches current key. Did you copy the wrong value?",
    );
    process.exit(1);
  }
  console.log(`[rotate-wompi] new      ${fingerprint("new", newKey)}`);

  // Update AWS Secrets Manager
  await client.send(
    new PutSecretValueCommand({
      SecretId: SECRET_NAME,
      SecretString: newKey,
    }),
  );
  console.log(`[rotate-wompi] ✅ updated secret in AWS Secrets Manager`);

  // Verify the rotation
  const verify = await client.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME }),
  );
  const verifiedPlaintext = verify.SecretString ?? "";
  if (verifiedPlaintext === newKey) {
    console.log(`[rotate-wompi] ✅ verified: AWS now has the new key`);
  } else {
    console.error("ERROR: verification failed — AWS secret doesn't match");
    process.exit(1);
  }

  // Audit: write a log entry (operator can grep for this)
  const auditEntry = {
    ts: new Date().toISOString(),
    action: "wompi-private-key-rotation",
    secret: SECRET_NAME,
    oldFingerprint: `sha256:${sha256(currentPlaintext)}`,
    newFingerprint: `sha256:${sha256(newKey)}`,
    actor: process.env.USERNAME || process.env.USER || "unknown",
  };
  console.log(`[rotate-wompi] audit: ${JSON.stringify(auditEntry)}`);
  console.log("\nNext steps:");
  console.log("  1. Verify Lambda picks up new key: npx sst deploy --stage dev");
  console.log("  2. Test a sandbox Wompi transaction end-to-end");
  console.log("  3. Remove the new key from .env / vault / 1Password");
}

main().catch((err) => {
  console.error("[rotate-wompi] FATAL:", err.message);
  process.exit(1);
});
