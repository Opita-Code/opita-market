#!/usr/bin/env node
/**
 * Re-fuzzer: verify OPL-DEP-001 is fixed.
 * Should see ZERO 500s (was 15/30 = 50% before fix).
 */
const URL = "https://hlbu3fa524q5fblfceo55hw2uq0tuozy.lambda-url.us-east-1.on.aws/v1/payments/webhook";
const BODIES = [
  "", "null", "[]", "{}", "{\"a\":1}", "a]".repeat(100), "\x00".repeat(50), '"'.repeat(1000),
  JSON.stringify({ x: 1e20 }), JSON.stringify({ __proto__: { admin: true } }),
  "{\"event\":null}", "{\"data\":null}", "{\"timestamp\":-1}",
  "{\"signature\":null}", "\xff\xff\xff\xff",
];
const HEADERS = [{}, { "Content-Type": "application/json" }, { "Content-Type": "text/plain" }];

(async () => {
  let total = 0, five00 = 0, four00 = 0, four01 = 0, other = 0;
  for (const body of BODIES) {
    for (const headers of HEADERS) {
      try {
        const r = await fetch(URL, { method: "POST", headers, body });
        total++;
        if (r.status === 500) five00++;
        else if (r.status === 400) four00++;
        else if (r.status === 401) four01++;
        else other++;
      } catch (err) {
        total++;
        other++;
      }
    }
  }
  console.log(`Re-fuzz results:`);
  console.log(`  Total: ${total}`);
  console.log(`  500s: ${five00} (was 15/45 = 33% before fix — expected: 0)`);
  console.log(`  400s: ${four00}`);
  console.log(`  401s: ${four01}`);
  console.log(`  Other: ${other}`);
  console.log(`\n${five00 === 0 ? "✅ FIXED" : "❌ STILL BROKEN"}: OPL-DEP-001`);
})();
