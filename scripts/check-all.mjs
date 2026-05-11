#!/usr/bin/env node
// arbiter quality gate
// Usage: node scripts/check-all.mjs [L1|L2|L3]
// L1: typecheck, format, lint, tests, circular deps, placeholders, orphan TODOs, commitlint, test naming (9)
// L2: L1 + coverage + dead code + npm audit + gitleaks secrets scan (13)
// L3: L2 + full repo secrets scan (nightly/manual)
//
// NOTE: this file runs without a build step and cannot import from src/.
// src/ code goes through src/utils/run-cli.ts (INV-12). Gate scripts are
// plain .mjs with their own inline helper that mirrors the same semantics:
// timeout, structured failure reporting, and non-zero exit aggregation.
import { spawnSync } from "node:child_process";

const level = process.argv[2] ?? "L2";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per check
let failed = 0;

// When the pre-commit hook rsyncs to a temp dir to work around the Vite '#' bug,
// git-dependent checks (commitlint, docs) must run from the original repo path.
const GIT_CWD = process.env.ARBITER_HOOK_GIT_CWD;

function runCheck(name, cmd, args, timeoutMs = DEFAULT_TIMEOUT_MS, opts = {}) {
  const start = Date.now();
  process.stdout.write(`[CHECK] ${name} ... `);
  const r = spawnSync(cmd, args, {
    encoding: "utf-8",
    shell: false,
    timeout: timeoutMs,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
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

// ─── L1: Fast checks (9) ─────────────────────────────────────────────────────
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
runCheck("inline suppressions", "node", [
  "scripts/check-inline-suppressions.mjs",
]);
runCheck(
  "commitlint",
  "npx",
  ["commitlint", "--from", "origin/main", "--to", "HEAD"],
  DEFAULT_TIMEOUT_MS,
  { cwd: GIT_CWD },
);
runCheck("test naming", "node", ["scripts/check-test-naming.mjs"]);
runCheck("hardness inventory", "node", [
  "scripts/check-hardness-inventory.mjs",
]);
runCheck("docs", "node", ["scripts/check-docs.mjs"], DEFAULT_TIMEOUT_MS, {
  cwd: GIT_CWD,
});

// ─── L2/L3: Full checks ───────────────────────────────────────────────────────
if (level === "L2" || level === "L3") {
  runCheck("coverage", "npm", ["test", "--", "--coverage"]);
  runCheck("dead code", "npx", ["knip"]);
  runCheck("audit", "npm", ["audit", "--audit-level=high"]);
  runCheck("gitleaks", "gitleaks", [
    "detect",
    "--source",
    ".",
    "--config",
    ".gitleaks.toml",
    "--gitleaks-ignore-path",
    "suppressions/.gitleaksignore",
    "--exit-code",
    "1",
  ]);
}

console.log("");
if (failed > 0) {
  console.error(`=== FAILED: ${failed} check(s) ===\n`);
  process.exit(1);
} else {
  console.log("=== ALL PASSED ===\n");
}
