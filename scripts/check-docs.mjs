#!/usr/bin/env node
// Docs gate: if src/ or __tests__/ changed vs origin/main, docs/ or README.md must also change.
// Mirrors the CI docs-check job so the gate fires locally before push.
import { spawnSync } from "node:child_process";

const r = spawnSync("git", ["diff", "--name-only", "origin/main..HEAD"], {
  encoding: "utf8",
});

if (r.status !== 0) {
  console.error("git diff failed:", r.stderr);
  process.exit(1);
}

// Also include staged files so a docs-only commit passes pre-commit (staged
// but not yet in HEAD).
const rStaged = spawnSync("git", ["diff", "--name-only", "--cached"], {
  encoding: "utf8",
});
const staged =
  rStaged.status === 0 ? rStaged.stdout.trim().split("\n").filter(Boolean) : [];

const changed = r.stdout.trim().split("\n").filter(Boolean);
const all = [...new Set([...changed, ...staged])];
const hasCode = all.some(
  (f) => f.startsWith("src/") || f.startsWith("__tests__/"),
);
const hasDocs = all.some((f) => f.startsWith("docs/") || f === "README.md");

if (hasCode && !hasDocs) {
  console.error("Code changed without documentation update.");
  console.error("Files changed in src/ or __tests__/:");
  all
    .filter((f) => f.startsWith("src/") || f.startsWith("__tests__/"))
    .forEach((f) => console.error(" ", f));
  console.error("Update docs/ or README.md to explain the change.");
  process.exit(1);
}
