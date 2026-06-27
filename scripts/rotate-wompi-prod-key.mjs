#!/usr/bin/env node
/**
 * Wompi prod key rotation helper (uses SST CLI — no direct AWS calls).
 *
 * Closes operator action #1 from PR 3 follow-ups.
 *
 * WHAT THIS SCRIPT DOES:
 *   1. Reads a NEW Wompi private key from the operator (env var or stdin).
 *   2. Updates SST Secret `WompiPrivateKey` via `npx sst secret set`.
 *      SST handles AWS Secrets Manager storage + Lambda binding.
 *   3. Verifies the rotation via `npx sst secret list`.
 *   4. Emits an audit log entry (sha256 fingerprint, NO plaintext).
 *
 * USAGE:
 *
 *   # Option A: read from env var (recommended — uses vault.ps1)
 *   $env:WOMPI_NEW_PRIVATE_KEY = & vault.ps1 exec wompi_new_private_key { Write-Output $env:SECRET }
 *   node scripts/rotate-wompi-prod-key.mjs
 *
 *   # Option B: read from stdin (paste, Ctrl-D / Ctrl-Z to end)
 *   node scripts/rotate-wompi-prod-key.mjs --stdin
 *
 *   # Option C: dry-run (verify only — no changes)
 *   node scripts/rotate-wompi-prod-key.mjs --dry-run
 *
 *   # Specify stage (default: dev)
 *   node scripts/rotate-wompi-prod-key.mjs --stage prod
 *
 * SAFETY:
 *   - Never logs the plaintext key.
 *   - Only sha256 fingerprints (12 chars prefix).
 *   - Validates new key length + that it differs from current.
 *
 * PREREQUISITES:
 *   - SST authenticated with AWS (uses opita-cicd profile)
 *   - Get new key from Wompi dashboard: https://merchant.wompi.co/
 *     → Settings → API Keys → Regenerate Private Key
 */

import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const STAGE = process.argv.includes("--stage")
  ? process.argv[process.argv.indexOf("--stage") + 1]
  : "dev";

const SECRET_NAME = "WompiPrivateKey";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function fingerprint(label, s) {
  return `${label}=sha256:${sha256(s)} (len=${s.length})`;
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts });
}

function readCurrentValue() {
  try {
    const list = run(`npx sst secret list --stage ${STAGE}`);
    const match = list.match(new RegExp(`^${SECRET_NAME}=(.+)$`, "m"));
    if (!match) throw new Error(`Secret ${SECRET_NAME} not found in stage ${STAGE}`);
    return match[1].trim();
  } catch (err) {
    throw new Error(`Failed to read current secret: ${err.message}`);
  }
}

function setNewValue(value) {
  // Use spawnSync with all stdio piped so we can capture + log stderr.
  // Pipe the new value via stdin (avoids shell-quoting + process listing leak).
  const proc = spawnSync(
    "npx",
    ["sst", "secret", "set", SECRET_NAME, "--stage", STAGE],
    {
      input: value,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  if (proc.status !== 0) {
    // Log full output for diagnosis
    console.error("[rotate-wompi] --- sst secret set stdout ---");
    console.error(proc.stdout ?? "(empty)");
    console.error("[rotate-wompi] --- sst secret set stderr ---");
    console.error(proc.stderr ?? "(empty)");
    console.error("[rotate-wompi] --- exit code:", proc.status, "---");
    throw new Error(
      `sst secret set failed with exit code ${proc.status}. ` +
        `Check AWS credentials (aws sts get-caller-identity) and that ` +
        `stage '${STAGE}' exists in SST.`,
    );
  }
  // sst prints "Updated secret" on success
  return proc.stdout ?? "";
}

function readNewKey() {
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

function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`[rotate-wompi] stage:     ${STAGE}`);
  console.log(`[rotate-wompi] secret:    ${SECRET_NAME}`);

  // Read current value for fingerprint comparison (NOT logged in plaintext)
  const currentPlaintext = readCurrentValue();
  console.log(
    `[rotate-wompi] current  ${fingerprint("current", currentPlaintext)}`,
  );

  if (dryRun) {
    console.log("[rotate-wompi] DRY RUN — no changes made.");
    console.log(
      "[rotate-wompi] next: get new prod key from Wompi dashboard, then re-run with the new key.",
    );
    return;
  }

  // Read new key
  const newKey = readNewKey();
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

  // Update via SST CLI (SST handles AWS Secrets Manager + Lambda binding)
  setNewValue(newKey);
  console.log(`[rotate-wompi] ✅ updated secret via SST`);

  // Verify by re-reading
  const verified = readCurrentValue();
  if (verified === newKey) {
    console.log(`[rotate-wompi] ✅ verified: SST now has the new key`);
  } else {
    console.error("ERROR: verification failed — SST doesn't match new value");
    process.exit(1);
  }

  // Audit log entry (no plaintext, only sha256 fingerprints)
  const auditEntry = {
    ts: new Date().toISOString(),
    action: "wompi-private-key-rotation",
    stage: STAGE,
    secret: SECRET_NAME,
    oldFingerprint: `sha256:${sha256(currentPlaintext)}`,
    newFingerprint: `sha256:${sha256(newKey)}`,
    actor: process.env.USERNAME || process.env.USER || "unknown",
  };
  console.log(`[rotate-wompi] audit: ${JSON.stringify(auditEntry)}`);
  console.log("\nNext steps:");
  console.log("  1. Deploy to pick up the new key: npx sst deploy --stage " + STAGE);
  console.log("  2. Test a sandbox Wompi transaction end-to-end");
  console.log("  3. Remove the new key from your 1Password / vault / .env");
}

main();
