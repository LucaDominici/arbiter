#!/usr/bin/env node
// arbiter quality gate
// Usage: node scripts/check-all.mjs [L1|L2]
// L1: typecheck, format, lint, tests, circular deps, placeholders, orphan TODOs, commitlint (8)
// L2: L1 + coverage + dead code (10)
//
// NOTE: this file runs without a build step and cannot import from src/.
// src/ code goes through src/utils/run-cli.ts (INV-12). Gate scripts are
// plain .mjs with their own inline helper that mirrors the same semantics:
// timeout, structured failure reporting, and non-zero exit aggregation.
import { spawnSync } from "node:child_process";

const level = process.argv[2] ?? "L2";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per check
let failed = 0;

function runCheck(name, cmd, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const start = Date.now();
  process.stdout.write(`[CHECK] ${name} ... `);
  const r = spawnSync(cmd, args, {
    encoding: "utf-8",
    shell: false,
    timeout: timeoutMs,
  });
  const elapsed = Date.now() - start;

  if (r.error && r.error.code === "ENOENT") {
    console.log(`FAIL (${elapsed}ms)`);
    console.error(`  command not found: ${cmd}`);
    failed++;
    return;
  }

  if (r.error && r.error.code === "ETIMEDOUT") {
    console.log(`FAIL (timeout after ${elapsed}ms)`);
    console.error(
      `  command exceeded ${timeoutMs}ms: ${cmd} ${args.join(" ")}`,
    );
    failed++;
    return;
  }

  if (r.status === 0) {
    console.log(`PASS (${elapsed}ms)`);
    return;
  }

  console.log(`FAIL (exit ${r.status}, ${elapsed}ms)`);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  failed++;
}

console.log("");
console.log(`=== arbiter Quality Gate: ${level} ===`);
console.log("");

// ─── L1: Fast checks (8) ─────────────────────────────────────────────────────
runCheck("typecheck", "npx", ["tsc", "--noEmit"]);
runCheck("format", "npx", ["prettier", "--check", "."]);
runCheck("lint", "npx", ["eslint", "src", "__tests__"]);
runCheck("unit tests", "npm", ["test"]);
runCheck("circular deps", "npx", [
  "madge",
  "--circular",
  "--extensions",
  "ts",
  "src/",
]);
runCheck("placeholders", "node", ["scripts/check-no-placeholders.mjs", "src"]);
runCheck("orphan TODOs", "node", ["scripts/check-no-orphan-todo.mjs"]);
runCheck("commitlint", "npx", [
  "commitlint",
  "--from",
  "origin/main",
  "--to",
  "HEAD",
]);
runCheck("test naming", "node", ["scripts/check-test-naming.mjs"]);

// ─── L2: Full checks (+2 = 10) ────────────────────────────────────────────────
if (level === "L2") {
  runCheck("coverage", "npm", ["test", "--", "--coverage"]);
  runCheck("dead code", "npx", ["knip"]);
}

console.log("");
if (failed > 0) {
  console.error(`=== FAILED: ${failed} check(s) ===\n`);
  process.exit(1);
} else {
  console.log("=== ALL PASSED ===\n");
}
