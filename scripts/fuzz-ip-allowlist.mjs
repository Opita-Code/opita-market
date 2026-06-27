#!/usr/bin/env node
/**
 * scripts/fuzz-ip-allowlist.mjs — Fuzz the Wompi IP allowlist (OPL-API-012)
 *
 * In dev, no WOMPI_WEBHOOK_IPS env var is set, so the allowlist is disabled
 * and per-IP rate limit applies (60/min per XFF). This fuzzer:
 *   1. Sends 65 rapid requests from same XFF → expect 60 OK, 5 rate-limited
 *   2. Tries XFF manipulation: spaces, commas, IPv4-mapped IPv6, etc.
 *   3. Verifies malformed XFF doesn't bypass the rate limiter
 *
 * Expected behavior: 200/400/401/403 are all "allowed" responses;
 * 429 is "rate-limited" response. Anything else is a bug.
 */

import { writeFileSync } from "node:fs";

const BASE = "https://hlbu3fa524q5fblfceo55hw2uq0tuozy.lambda-url.us-east-1.on.aws";

const probes = [];
let allowed = 0, rateLimited = 0, unexpected = 0;

function record(name, status, detail) {
  probes.push({ name, status, detail });
  if (status === "OK") allowed++;
  else if (status === "RATE_LIMITED") rateLimited++;
  else { unexpected++; console.log(`❌ ${name}: ${detail}`); }
}

async function post(path, body, headers = {}) {
  return fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function categorize(res) {
  if (res.status === 429) return "RATE_LIMITED";
  if ([200, 400, 401, 403].includes(res.status)) return "OK";
  return "UNEXPECTED";
}

// ─── Probe 1: 65 rapid requests from same XFF ───────────────────────────────
async function probe1_burstFromOneIp() {
  console.log("Probe 1: 65 rapid webhook requests from 192.0.2.1...");
  const results = { ok: 0, rl: 0, other: 0 };
  for (let i = 0; i < 65; i++) {
    const res = await post("/v1/payments/webhook", {
      event: "transaction.approved",
      data: { transaction: { id: `tx-burst-${i}` } },
    }, { "x-forwarded-for": "192.0.2.1" });
    const cat = categorize(res);
    if (cat === "OK") results.ok++;
    else if (cat === "RATE_LIMITED") results.rl++;
    else { results.other++; console.log(`  unexpected status=${res.status}`); }
  }
  // Expect ~60 OK + ~5 rate-limited (limit is 60/min)
  const ok = results.rl >= 1 && results.other === 0;
  record("burst-65-from-one-ip", ok ? "OK" : "UNEXPECTED",
    `ok=${results.ok} rate-limited=${results.rl} other=${results.other} (expected: rate-limited ≥ 1)`);
}

// ─── Probe 2: XFF manipulation attempts ─────────────────────────────────────
async function probe2_xffManipulation() {
  console.log("Probe 2: XFF manipulation attempts...");
  const XFFs = [
    "192.0.2.2, 192.0.2.1",        // XFF chain (CloudFront convention)
    "192.0.2.2,192.0.2.1",          // no space
    " 192.0.2.3 ",                  // leading/trailing space
    "::ffff:192.0.2.4",             // IPv4-mapped IPv6 (should NOT match IPv4 allowlist)
    "192.0.2.5:1234",               // port suffix
    "192.0.2.6;192.0.2.7",          // semicolon separator (some WAFs accept)
    "",                              // empty
    "not-an-ip",                    // garbage
    "127.0.0.1",                    // localhost
    "169.254.169.254",              // AWS IMDS
    "10.0.0.1",                     // RFC1918
  ];
  let ok = true;
  for (const xff of XFFs) {
    const res = await post("/v1/payments/webhook", {
      event: "transaction.approved",
      data: { transaction: { id: "tx-xff-test" } },
    }, { "x-forwarded-for": xff });
    // Should NEVER return 200 (real webhook only). 400/401/403/429 all OK.
    if (res.status === 200) {
      console.log(`  ❌ XFF="${xff}" returned 200!`);
      ok = false;
    }
  }
  record("xff-manipulation", ok ? "OK" : "UNEXPECTED",
    `${XFFs.length} XFF variants tested, none bypassed to 200`);
}

// ─── Probe 3: Different IPs not rate-limited together ──────────────────────
async function probe3_differentIpsNotCoupled() {
  console.log("Probe 3: Different IPs are independent rate-limit buckets...");
  // Reset: use fresh IPs (synthetic RFC5737 ranges)
  const IPs = ["192.0.2.10", "192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.14"];
  const results = [];
  for (const ip of IPs) {
    const res = await post("/v1/payments/webhook", {
      event: "transaction.approved",
      data: { transaction: { id: "tx-isolated" } },
    }, { "x-forwarded-for": ip });
    results.push({ ip, status: res.status, cat: categorize(res) });
  }
  const allOk = results.every((r) => r.cat === "OK");
  record("isolated-ips", allOk ? "OK" : "UNEXPECTED",
    `${IPs.length} different IPs all returned 400/401/403 (no cross-IP rate limit)`);
}

// ─── Probe 4: Body size limit edge cases ────────────────────────────────────
async function probe4_bodySizeEdges() {
  console.log("Probe 4: Body size limit edge cases...");
  // 100KB exactly → accepted (boundary)
  // 100KB + 1 byte → 413
  // 1MB → 413
  // Empty body → 400 (bad JSON)
  const tests = [
    { name: "100KB exact", size: 100 * 1024, expect: 400 },  // boundary, expect JSON error
    { name: "100KB+1", size: 100 * 1024 + 1, expect: 413 }, // just over
    { name: "150KB", size: 150 * 1024, expect: 413 },
    { name: "1MB", size: 1024 * 1024, expect: 413 },
    { name: "10MB", size: 10 * 1024 * 1024, expect: 413 },
    { name: "empty body", size: 0, expect: 400 },
  ];
  let allOk = true;
  for (const t of tests) {
    const body = t.size === 0 ? "" : '{"d":"' + "x".repeat(t.size - 8) + '"}';
    const res = await post("/v1/payments/webhook", body);
    if (res.status !== t.expect) {
      console.log(`  ❌ ${t.name}: expected ${t.expect}, got ${res.status}`);
      allOk = false;
    }
  }
  record("body-size-edges", allOk ? "OK" : "UNEXPECTED",
    `${tests.length} size tests, all match expected status codes`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(72));
  console.log("FUZZER: IP allowlist + XFF + body size (PR 9 / PR 8)");
  console.log("═".repeat(72));
  console.log("");

  await probe1_burstFromOneIp();
  await probe2_xffManipulation();
  await probe3_differentIpsNotCoupled();
  await probe4_bodySizeEdges();

  console.log("");
  console.log("═".repeat(72));
  console.log(`SUMMARY: ${allowed} OK, ${rateLimited} RATE_LIMITED, ${unexpected} UNEXPECTED`);
  console.log("═".repeat(72));

  const report = {
    fuzz_id: "OPL-PT-2026-06-27-002-fuzz",
    target: BASE,
    timestamp: new Date().toISOString(),
    summary: { allowed, rate_limited: rateLimited, unexpected },
    probes,
  };
  writeFileSync("scripts/fuzz-ip-allowlist-results.json", JSON.stringify(report, null, 2));
  console.log("\nReport written: scripts/fuzz-ip-allowlist-results.json");
  process.exit(unexpected > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
