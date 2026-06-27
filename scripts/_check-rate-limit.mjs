#!/usr/bin/env node
/**
 * Quick check: is the per-IP rate limit instance-local or actually broken?
 *
 * Sends 70 requests SEQUENTIALLY from same XFF (no parallel = no scaling).
 * If rate limit works: 60 OK + 10 rate-limited.
 * If broken: all 70 OK.
 */

const BASE = "https://hlbu3fa524q5fblfceo55hw2uq0tuozy.lambda-url.us-east-1.on.aws";

let ok = 0, rl = 0, other = 0;
const start = Date.now();
for (let i = 0; i < 70; i++) {
  const res = await fetch(BASE + "/v1/payments/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.50",
    },
    body: JSON.stringify({ event: "test", data: { transaction: { id: `tx-seq-${i}` } } }),
  });
  if (res.status === 429) rl++;
  else if ([200, 400, 401, 403].includes(res.status)) ok++;
  else other++;
}
const elapsed = ((Date.now() - start) / 1000).toFixed(2);
console.log(`Sequential 70 requests: ${ok} OK, ${rl} 429, ${other} other (${elapsed}s)`);
console.log(`Verdict: ${rl === 0 ? "❌ rate limit BROKEN (instance-local in Lambda)" : "✅ rate limit working"}`);
process.exit(rl === 0 ? 1 : 0);
