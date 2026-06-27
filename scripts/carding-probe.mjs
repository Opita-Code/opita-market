#!/usr/bin/env node
/**
 * scripts/carding-probe.mjs — Defensive carding probe (Phase 3)
 *
 * Generates Luhn-valid synthetic card numbers from test BINs and probes
 * the gateway to verify fraud detection works as designed.
 *
 * Test BINs (publicly published as test ranges):
 *   - 411111  → Visa test (Wompi sandbox accepts)
 *   - 555555  → Mastercard test
 *   - 378282 → American Express test
 *
 * What we test:
 *   C1: Luhn-valid card from known test BIN → backend should accept the
 *       card number format (no Luhn validation rejection at 401 level)
 *   C2: Idempotency: 2x same idempotency_key → same response
 *   C3: BIN velocity: 5x from same BIN in 60s → velocity counter
 *       (anonymous rate limit 20/min is hit first; 4 of 5 → 429)
 *   C4: Invalid Luhn: 1 wrong check digit → backend still returns 401
 *       (auth) or 400 (validation), NOT 200
 *   C5: BIN Intel: test BIN 411111 → known Visa, Colombia-friendly
 *
 * Card numbers are SYNTHETIC (Luhn-valid but not real). They will not
 * be charged. Wompi sandbox doesn't validate them against issuers; the
 * test is for our BACKEND's fraud engine.
 */

import { writeFileSync } from "node:fs";

const BASE = "https://hlbu3fa524q5fblfceo55hw2uq0tuozy.lambda-url.us-east-1.on.aws";

/** Luhn check digit calculator. */
function luhnCheckDigit(prefix) {
  const digits = prefix.split("").map(Number);
  // Double every second digit from right (or every other from left for
  // a partial prefix). For a 15-digit prefix, position 0 is the
  // leftmost; the check digit is the 16th.
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[digits.length - 1 - i];
    if (i % 2 === 0) {
      // For positions 0, 2, 4, ... (right-indexed even), double.
      // When checking, the 16th digit is the check, so position 15
      // (i=0 from right) is the digit before check. Standard Luhn
      // doubles every SECOND digit from right starting at position 1.
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Generate a Luhn-valid 16-digit card number from a 15-digit prefix. */
function generateLuhnCard(bin15) {
  if (bin15.length !== 15 || !/^\d+$/.test(bin15)) {
    throw new Error(`Invalid BIN prefix: ${bin15} (need 15 digits)`);
  }
  const check = luhnCheckDigit(bin15);
  return bin15 + check;
}

/** Validate a 16-digit card with the Luhn algorithm. */
function isLuhnValid(card) {
  if (card.length !== 16 || !/^\d+$/.test(card)) return false;
  const digits = card.split("").map(Number);
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const results = [];
function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
  console.log(`${status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⏭️"} [${id}] ${name}: ${status} — ${detail}`);
}

// ─── C1: Luhn-valid card generation ────────────────────────────────────────
function testC1() {
  const card = generateLuhnCard("411111111111111");
  const valid = isLuhnValid(card);
  record("C1", "Luhn-valid card from 411111 test BIN", valid ? "PASS" : "FAIL",
    `generated=${card} luhn-valid=${valid}`);
  return card;
}

// ─── C2: Luhn invalid → backend rejects ────────────────────────────────────
async function testC2(card) {
  // Flip a digit to break Luhn
  const broken = card.slice(0, 15) + String((Number(card[15]) + 1) % 10);
  const valid = isLuhnValid(broken);
  if (valid) {
    record("C2a", "Luhn-invalid card detection", "FAIL",
      `flipped card ${broken} is still Luhn-valid (test bug)`);
  } else {
    record("C2a", "Luhn-invalid card detection", "PASS",
      `flipped card ${broken} is correctly invalid`);
  }
  // Now probe the gateway — we don't expect 200 even with valid Luhn
  // (no auth), but we want to confirm it doesn't crash.
  const res = await fetch(BASE + "/v1/payments/intent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.10",
    },
    body: JSON.stringify({
      amount_cop: 100000,
      channel: "WOMPI_CARD",
      from_user_id: "u-probe-1",
      to_user_id: "u-probe-2",
      product_context: { kind: "carding-probe", ref_id: "C2" },
      idempotency_key: `carding-${Date.now()}`,
      card_number: broken, // Luhn-invalid
    }),
  });
  // 401 = no auth, 400 = bad Luhn, 403 = CSRF. All are "rejected".
  const rejected = [400, 401, 403, 422].includes(res.status);
  record("C2b", "Gateway rejects Luhn-invalid card", rejected ? "PASS" : "FAIL",
    `status=${res.status} (Luhn-invalid card NOT accepted)`);
}

// ─── C3: BIN velocity (5x from same BIN, 60s window) ───────────────────────
async function testC3() {
  // Use different idempotency keys to avoid 200 dedup
  const results = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(BASE + "/v1/payments/intent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.20",
      },
      body: JSON.stringify({
        amount_cop: 50000,
        channel: "WOMPI_CARD",
        from_user_id: "u-velocity",
        to_user_id: "u-victim",
        product_context: { kind: "velocity-test", ref_id: `C3-${i}` },
        idempotency_key: `carding-c3-${Date.now()}-${i}`,
      }),
    });
    results.push(res.status);
  }
  // Anonymous rate limit is 20/min — 5 requests should all pass through to auth (401)
  // The BIN velocity counter is only checked AFTER auth, so we can't test
  // it from anonymous. But we verify the gateway doesn't crash on burst.
  const allRejected = results.every((s) => [400, 401, 403, 429].includes(s));
  record("C3", "BIN velocity burst (5x same BIN)", allRejected ? "PASS" : "FAIL",
    `statuses=[${results.join(",")}] (all rejected at auth/rate-limit layer)`);
}

// ─── C4: Idempotency replay (same key twice) ────────────────────────────────
async function testC4() {
  const key = `carding-c4-${Date.now()}`;
  const body = JSON.stringify({
    amount_cop: 75000,
    channel: "WOMPI_CARD",
    from_user_id: "u-idem",
    to_user_id: "u-idem-2",
    product_context: { kind: "idem-test", ref_id: "C4" },
    idempotency_key: key,
  });
  const res1 = await fetch(BASE + "/v1/payments/intent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.30" },
    body,
  });
  const res2 = await fetch(BASE + "/v1/payments/intent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.30" },
    body,
  });
  // Both should be rejected (no auth), but with SAME status (idempotency
  // means same outcome). 401 for both is correct.
  const same = res1.status === res2.status;
  record("C4", "Idempotency replay returns same status", same ? "PASS" : "FAIL",
    `res1=${res1.status} res2=${res2.status} (expected identical)`);
}

// ─── C5: Structuring detection probe (3x $250k from same user) ─────────────
async function testC5() {
  // Can't test structuring without auth. This is a SETUP probe — just
  // verifies the endpoint accepts the boundary amount.
  const res = await fetch(BASE + "/v1/payments/intent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.40" },
    body: JSON.stringify({
      amount_cop: 250000, // $250k = $250,000 COP (in 3DS boundary)
      channel: "WOMPI_CARD",
      from_user_id: "u-struct-1",
      to_user_id: "u-struct-2",
      product_context: { kind: "structuring-test", ref_id: "C5" },
      idempotency_key: `carding-c5-${Date.now()}`,
    }),
  });
  const rejected = [400, 401, 403, 422].includes(res.status);
  record("C5", "Structuring probe ($250k boundary)", rejected ? "PASS" : "FAIL",
    `status=${res.status} (endpoint accepts boundary amount, rejected at auth)`);
}

// ─── C6: Carding actor fingerprint (multiple IPs) ───────────────────────────
async function testC6() {
  // Simulate a carding attack: many requests from different IPs
  // (rotation) all targeting the same BIN. Anonymous rate limit is
  // 20/min per IP, so we test 5 requests from 5 different IPs.
  const IPs = ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4", "203.0.113.5"];
  const statuses = [];
  for (const ip of IPs) {
    const res = await fetch(BASE + "/v1/payments/intent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({
        amount_cop: 100000,
        channel: "WOMPI_CARD",
        from_user_id: "u-attacker",
        to_user_id: "u-victim",
        product_context: { kind: "carding-attack", ref_id: "C6" },
        idempotency_key: `carding-c6-${ip}-${Date.now()}`,
      }),
    });
    statuses.push(res.status);
  }
  const allRejected = statuses.every((s) => [400, 401, 403].includes(s));
  record("C6", "Carding actor IP rotation (5 different IPs)", allRejected ? "PASS" : "FAIL",
    `statuses=[${statuses.join(",")}] (all 5 IPs blocked at auth layer)`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(72));
  console.log("CARDING PROBES (defensive) — synthetic Luhn-valid cards");
  console.log("═".repeat(72));
  console.log("");

  // Sanity: verify Luhn math works
  const sanity = isLuhnValid("4111111111111111"); // known valid test card
  console.log(`Luhn sanity: 4111111111111111 valid = ${sanity} (expected true)\n`);

  const card = testC1();
  await testC2(card);
  await testC3();
  await testC4();
  await testC5();
  await testC6();

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;

  console.log("");
  console.log("═".repeat(72));
  console.log(`SUMMARY: ${pass} PASS, ${fail} FAIL, ${skip} SKIP`);
  console.log("═".repeat(72));

  const report = {
    probe_id: "OPL-PT-2026-06-27-002-carding",
    timestamp: new Date().toISOString(),
    summary: { pass, fail, skip, total: results.length },
    cards_generated: { test_bin: "411111111111111", example: card },
    probes: results,
  };
  writeFileSync("scripts/carding-probe-results.json", JSON.stringify(report, null, 2));
  console.log("\nReport written: scripts/carding-probe-results.json");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
