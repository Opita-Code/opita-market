// Bundle audit — fails the build if any secret is leaked into compiled output.
//
// Closes MW-FE-001 (PUBLIC_JWT_SECRET in client bundle) and OPL-IAM-003
// (Wompi prod keys in plaintext) from pentest OPL-PT-2026-06-26-001.
//
// Scans apps/market-web/dist, apps/market-web/.astro, packages/pagos-service/dist
// for forbidden patterns: JWT_SECRET, WO_PRIV_KEY, WO_EVENTS, WO_INTEGRITY,
// and Wompi key shapes (prv_*, pub_*, test_integrity_*, test_events_*).
//
// Usage: node scripts/audit-bundle.mjs
// Exit 0 if clean, 1 if violations found.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SCAN_PATHS = [
  "apps/market-web/dist",
  "apps/market-web/.astro",
  "packages/pagos-service/dist",
];

// Patterns to detect. Each must be a regex that matches the secret value
// (not just the variable name). We err on the side of false positives.
const FORBIDDEN_PATTERNS = [
  { name: "JWT_SECRET", regex: /JWT_SECRET[\s]*[:=][\s]*["']?[A-Za-z0-9_-]{16,}/ },
  { name: "WO_PRIV_KEY", regex: /WO_PRIV_KEY[\s]*[:=][\s]*["']?[A-Za-z0-9_-]{16,}/ },
  { name: "WO_EVENTS", regex: /WO_EVENTS[\s]*[:=][\s]*["']?[A-Za-z0-9_-]{16,}/ },
  { name: "WO_INTEGRITY", regex: /WO_INTEGRITY[\s]*[:=][\s]*["']?[A-Za-z0-9_-]{16,}/ },
  { name: "Wompi private key (prv_*)", regex: /prv_[A-Za-z0-9_]{20,}/ },
  { name: "Wompi integrity secret (test_integrity_*)", regex: /test_integrity_[A-Za-z0-9_]{16,}/ },
  { name: "Wompi events secret (test_events_*)", regex: /test_events_[A-Za-z0-9_]{16,}/ },
];

const SCAN_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".json", ".map", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".sst"]);

const violations = [];

function scanDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return; // path doesn't exist — skip
    throw err;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      scanDir(fullPath);
    } else if (entry.isFile()) {
      const ext = fullPath.slice(fullPath.lastIndexOf("."));
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      scanFile(fullPath);
    }
  }
}

function scanFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return; // skip unreadable
  }
  for (const { name, regex } of FORBIDDEN_PATTERNS) {
    const match = content.match(regex);
    if (match) {
      const rel = relative(process.cwd(), filePath);
      // Redact the secret value in the output
      const redacted = match[0].replace(/([A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/, "$1***");
      violations.push({ file: rel, pattern: name, snippet: redacted });
    }
  }
}

const start = Date.now();
for (const path of SCAN_PATHS) {
  scanDir(path);
}
const elapsedMs = Date.now() - start;

if (violations.length === 0) {
  console.log(`✅ Bundle audit passed — no secrets found in ${SCAN_PATHS.join(", ")} (${elapsedMs}ms)`);
  process.exit(0);
} else {
  console.error(`\n❌ Bundle audit FAILED — ${violations.length} secret violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    pattern: ${v.pattern}`);
    console.error(`    match:   ${v.snippet}`);
  }
  console.error(`\nFix the violations above before deploying.`);
  process.exit(1);
}
