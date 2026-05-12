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

const IS_CI =
  process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const NO_COLOR = IS_CI || process.env.NO_COLOR === "1";

// Strips ANSI escape sequences from a string
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** @type {{ name: string; status: string; elapsed: number }[]} */
const results = [];

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
    if (IS_CI) console.log(`::error::${name}::command not found: ${cmd}`);
    console.error(`  command not found: ${cmd}`);
    results.push({ name, status: "FAIL", elapsed });
    failed++;
    return;
  }

  if (r.error && r.error.code === "ETIMEDOUT") {
    console.log(`FAIL (timeout after ${elapsed}ms)`);
    if (IS_CI) console.log(`::error::${name}::timeout after ${elapsed}ms`);
    console.error(
      `  command exceeded ${timeoutMs}ms: ${cmd} ${args.join(" ")}`,
    );
    results.push({ name, status: "FAIL", elapsed });
    failed++;
    return;
  }

  if (r.status === 0) {
    console.log(`PASS (${elapsed}ms)`);
    results.push({ name, status: "PASS", elapsed });
    return;
  }

  console.log(`FAIL (exit ${r.status}, ${elapsed}ms)`);
  if (IS_CI) console.log(`::error::${name}::exit ${r.status}`);
  if (r.stdout) process.stdout.write(NO_COLOR ? stripAnsi(r.stdout) : r.stdout);
  if (r.stderr) process.stderr.write(NO_COLOR ? stripAnsi(r.stderr) : r.stderr);
  results.push({ name, status: "FAIL", elapsed });
  failed++;
}

console.log("");
console.log(`=== arbiter Quality Gate: ${level} ===`);
console.log("");

// ─── L1: Fast checks ─────────────────────────────────────────────────────────
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
runCheck("suppressions expiry", "node", ["scripts/check-suppressions.mjs"]);
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
runCheck("matrix fixtures", "node", ["scripts/check-matrix-fixtures.mjs"]);
runCheck("matrix proven cells", "node", [
  "scripts/check-matrix-proven-cells.mjs",
]);
runCheck("template tests", "node", ["scripts/check-template-tests.mjs"]);
runCheck("generator tests", "node", ["scripts/check-generator-tests.mjs"]);
runCheck("command tests", "node", ["scripts/check-command-tests.mjs"]);
runCheck("catalog parity", "node", ["scripts/check-catalog-agents-parity.mjs"]);
runCheck("enforcement wired", "node", [
  "scripts/check-inv-enforcement-wired.mjs",
]);
runCheck("workflow runners", "node", ["scripts/check-workflow-runners.mjs"]);
runCheck("ci alignment", "node", ["scripts/check-ci-alignment.mjs"]);
runCheck("bloat ratchet", "node", ["scripts/check-bloat-ratchet.mjs"]);
runCheck("exit code contract", "node", [
  "scripts/check-exit-code-contract.mjs",
]);
runCheck("pipe/tee hazard", "node", ["scripts/check-pipe-tee-hazard.mjs"]);

// ─── L2/L3: Full checks ───────────────────────────────────────────────────────
if (level === "L2" || level === "L3") {
  runCheck("coverage", "npm", ["test", "--", "--coverage"]);
  runCheck("dead code", "npx", ["knip"]);
  runCheck("duplication", "npx", ["jscpd", "--silent"]);
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
  runCheck("dogfood", "node", ["scripts/check-self-dogfood.mjs"]);
  runCheck("self-validation drill", "node", ["scripts/self-validation.mjs"]);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Summary ===");
console.log("");

const nameWidth = Math.max(6, ...results.map((r) => r.name.length));
const header = `${"Check".padEnd(nameWidth)}  Status  Elapsed`;
const divider = "-".repeat(header.length);
console.log(header);
console.log(divider);
let totalElapsed = 0;
for (const r of results) {
  totalElapsed += r.elapsed;
  console.log(
    `${r.name.padEnd(nameWidth)}  ${r.status.padEnd(6)}  ${r.elapsed}ms`,
  );
}
console.log(divider);
console.log(`${"Total".padEnd(nameWidth)}          ${totalElapsed}ms`);
console.log("");

if (failed > 0) {
  console.error(`=== FAILED: ${failed} check(s) ===\n`);
  process.exit(1);
} else {
  console.log("=== ALL PASSED ===\n");
}
