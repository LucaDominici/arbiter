#!/usr/bin/env node
// Test naming convention gate for arbiter (TypeScript)
// Flags test files that don't follow the *.test.ts or *.spec.ts convention.
// Exit 1 if violations found (HARD gate — L1+).
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

let violations = 0;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".nyc_output",
]);

function walkTs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkTs(full);
    } else if (extname(entry) === ".ts" && !entry.endsWith(".d.ts")) {
      const looksLikeTest =
        entry.endsWith(".test.ts") || entry.endsWith(".spec.ts");
      let content = "";
      try {
        content = readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const hasTestImport =
        content.includes("from 'vitest'") ||
        content.includes('from "vitest"') ||
        content.includes("from '@jest") ||
        content.includes('from "@jest') ||
        (content.includes("describe(") && content.includes("it("));
      if (hasTestImport && !looksLikeTest) {
        console.error(
          `[NAMING] ${full}: test file must be named *.test.ts or *.spec.ts`,
        );
        violations++;
      }
    }
  }
}

walkTs("src");
walkTs("__tests__");

if (violations > 0) {
  console.error(
    `\n[NAMING] ${violations} violation(s) found. Rename files to follow the convention.\n`,
  );
  process.exit(1);
} else {
  console.log("[NAMING] All test files follow naming convention.");
}
