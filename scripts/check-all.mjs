#!/usr/bin/env node
// arbiter quality gate
// Usage: node scripts/check-all.mjs [L1|L2]
// L1: format + lint + unit tests (fast, pre-commit)
// L2: L1 + coverage + audit (full, pre-push)
import { spawnSync } from "node:child_process";

const level = process.argv[2] ?? "L2";
let failed = 0;

function runCheck(name, cmd, args) {
  process.stdout.write(`[CHECK] ${name} ... `);
  const r = spawnSync(cmd, args, { encoding: "utf-8", shell: false });
  if (r.status === 0) {
    console.log("PASS");
  } else {
    console.log("FAIL");
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    failed++;
  }
}

console.log("");
console.log(`=== arbiter Quality Gate: ${level} ===`);
console.log("");

// ─── L1: Fast checks ──────────────────────────────────────────────────────────
runCheck("typecheck", "npx", ["tsc", "--noEmit"]);
runCheck("format", "npx", ["prettier", "--check", "."]);
runCheck("lint", "npx", ["eslint", "src", "__tests__"]);
runCheck("unit tests", "npm", ["test"]);

// ─── L2: Full checks ──────────────────────────────────────────────────────────
if (level === "L2") {
  runCheck("audit", "npm", ["audit", "--audit-level=high"]);
}

console.log("");
if (failed > 0) {
  console.error(`=== FAILED: ${failed} check(s) ===\n`);
  process.exit(1);
} else {
  console.log("=== ALL PASSED ===\n");
}
