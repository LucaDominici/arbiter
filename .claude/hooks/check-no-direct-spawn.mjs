#!/usr/bin/env node
// Arbiter hook: enforce INV-12 — no direct child_process usage outside
// src/utils/run-cli.ts. All CLI invocations in src/ must go through the
// shared run-cli wrapper (see ADR-020).
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from "node:fs";
import { relative } from "node:path";

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? "";
if (!file || !existsSync(file)) process.exit(0);
if (!file.endsWith(".ts") && !file.endsWith(".tsx")) process.exit(0);

const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);

const rel = relative(repoRoot, file);
if (!rel.startsWith("src/")) process.exit(0);

// The wrapper itself is the single allowed call site.
if (rel === "src/utils/run-cli.ts") process.exit(0);

let content;
try {
  content = readFileSync(file, "utf-8");
} catch {
  process.exit(0);
}

const patterns = [
  /from\s+['"]node:child_process['"]/,
  /from\s+['"]child_process['"]/,
  /require\(['"]child_process['"]\)/,
  /require\(['"]node:child_process['"]\)/,
];

const offending = content
  .split("\n")
  .flatMap((line, i) =>
    patterns.some((p) => p.test(line)) ? [`${i + 1}: ${line.trim()}`] : [],
  );

if (offending.length > 0) {
  process.stderr.write(
    `[arbiter] INV-12: direct child_process import forbidden in ${rel}\n`,
  );
  process.stderr.write(
    `  Use runCli / runCliJson from src/utils/run-cli.ts instead (ADR-020).\n`,
  );
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`));
  process.exit(1);
}
