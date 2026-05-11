#!/usr/bin/env node
// Scans source files for placeholder patterns and disabled tests.
// Usage: node scripts/check-no-placeholders.mjs [dir...]
// Exits 1 if any violations are found.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PATTERNS = [
  { re: /\bPLACEHOLDER\b/i, label: "PLACEHOLDER" },
  { re: /\bFIXME\b/, label: "FIXME" },
  { re: /\bXXX\b/, label: "XXX" },
  { re: /\bHACK\b/, label: "HACK" },
  { re: /\bWIP\b/, label: "WIP" },
  { re: /\bCHANGEME\b/i, label: "CHANGEME" },
  { re: /\bREPLACEME\b/i, label: "REPLACEME" },
  {
    re: /\b(it|describe|test)\.skip\s*\(/,
    label: "it.skip/describe.skip/test.skip",
  },
  { re: /\b(xit|xdescribe|xtest)\s*\(/, label: "xit/xdescribe/xtest" },
];

const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
// Skip EJS template trees by relative path — they contain pattern strings, not violations
const SKIP_PATHS = new Set(["src/templates"]);

const scanDirs =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : [process.cwd()];
const baseDir = process.cwd();
let violations = 0;

function scan(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (SKIP_PATHS.has(relative(baseDir, full))) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      scan(full);
    } else if (EXTENSIONS.has(full.slice(full.lastIndexOf(".")))) {
      scanFile(full);
    }
  }
}

function scanFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, label } of PATTERNS) {
      if (re.test(line)) {
        const rel = relative(baseDir, filePath);
        console.log(`  ${rel}:${i + 1}  [${label}]  ${line.trim()}`);
        violations++;
        break;
      }
    }
  }
}

for (const dir of scanDirs) {
  scan(dir);
}

if (violations > 0) {
  console.log(
    `\n  Found ${violations} violation(s). Remove placeholders before committing.\n`,
  );
  process.exit(1);
}
