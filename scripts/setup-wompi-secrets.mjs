#!/usr/bin/env node
/**
 * Setup Wompi secrets in AWS Secrets Manager via SST.
 *
 * Reads WO_PUB_KEY, WO_PRIV_KEY, WO_EVENTS, WO_INTEGRITY from .env
 * and sets them as SST Secrets (encrypted at rest in AWS Secrets Manager).
 *
 * After running, the values are removed from .env and accessed via:
 *   import { Resource } from "sst";
 *   const key = Resource.WompiPrivateKey.value;
 *
 * OR via process.env.WOMPI_PRIVATE_KEY (legacy code paths).
 *
 * SAFETY: this script NEVER echoes the secret values. It only confirms
 * the count of secrets set.
 *
 * Usage:
 *   node scripts/setup-wompi-secrets.mjs
 *   node scripts/setup-wompi-secrets.mjs --stage prod
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const STAGE = process.argv.includes("--stage")
  ? process.argv[process.argv.indexOf("--stage") + 1]
  : "dev";

const ENV_PATH = ".env";

const MAPPINGS = {
  WO_PUB_KEY: "WompiPublicKey",
  WO_PRIV_KEY: "WompiPrivateKey",
  WO_EVENTS: "WompiEventsSecret",
  WO_INTEGRITY: "WompiIntegritySecret",
};

if (!existsSync(ENV_PATH)) {
  console.error(`❌ ${ENV_PATH} not found in current directory`);
  process.exit(1);
}

const envContent = readFileSync(ENV_PATH, "utf8");
const env = Object.fromEntries(
  envContent
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq === -1) return [line.trim(), ""];
      return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
    }),
);

console.log(`\n🔐 Setting ${Object.keys(MAPPINGS).length} Wompi secrets via SST (stage: ${STAGE})...\n`);

let success = 0;
let failed = 0;

for (const [envKey, secretName] of Object.entries(MAPPINGS)) {
  const value = env[envKey];
  if (!value) {
    console.error(`  ✗ ${secretName} — missing ${envKey} in .env`);
    failed++;
    continue;
  }
  try {
    // Pass the value via stdin to avoid shell-quoting issues and prevent
    // the value from appearing in process listings.
    const proc = execSync(`npx sst secret set ${secretName} --stage ${STAGE}`, {
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`  ✓ ${secretName} set (length: ${value.length})`);
    success++;
  } catch (err) {
    const msg = err && err.message ? err.message.split("\n")[0] : String(err);
    console.error(`  ✗ ${secretName} — failed: ${msg}`);
    failed++;
  }
}

console.log(`\n${"=".repeat(60)}`);
if (failed === 0) {
  console.log(`✅ All ${success} Wompi secrets set in SST (stage: ${STAGE}).`);
  console.log(`\nNext steps:`);
  console.log(`  1. Verify with: npx sst secret list --stage ${STAGE}`);
  console.log(`  2. Deploy: npx sst deploy --stage ${STAGE}`);
  console.log(`  3. After deploy, rotate the values that were in plaintext .env:`);
  console.log(`     - Wompi dashboard → Settings → Regenerate keys`);
  console.log(`     - Then re-run this script to update the secrets`);
  console.log(`  4. Remove WO_* lines from .env (keep only for reference, prefixed with #)`);
  process.exit(0);
} else {
  console.error(`❌ ${failed} secret(s) failed. ${success} succeeded.`);
  console.error(`Fix the issues above and re-run.`);
  process.exit(1);
}
