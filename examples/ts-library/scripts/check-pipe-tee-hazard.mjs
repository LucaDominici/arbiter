#!/usr/bin/env node
// Advisory scan: detects `| tee` without `set -o pipefail` or PIPESTATUS guard.
// Unguarded pipe/tee masks exit-code failures (the tee command always exits 0).
// Usage: node scripts/check-pipe-tee-hazard.mjs [dir...]
// Always exits 0 (advisory — emits [WARN], does not block).
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { walkRepo } from "./lib/glob-walk.mjs";

// Context window for guard detection (lines above and below the tee line).
const CONTEXT_LINES = 20;

const PIPE_TEE_RE = /\|\s*tee\b/;
const PIPEFAIL_RE = /set\s+-[a-z]*o\s+pipefail|set\s+-[a-z]*o pipefail/;
const PIPESTATUS_RE = /\$\{?PIPESTATUS\[/;

// File suffixes scanned for unguarded pipe/tee. Shell scripts and the EJS
// templates that emit shell: bare `.sh`, `.sh.ejs` / `.mjs.ejs` script
// templates, and workflow templates (`.yml.ejs` / `.yaml.ejs`) whose `run:`
// blocks are shell. Single source of truth for the walk filter below
// (#1523: the old `.ejs`-wide set was dead and dropped `.yml.ejs` coverage).
const SCAN_SUFFIXES = [".sh", ".sh.ejs", ".mjs.ejs", ".yml.ejs", ".yaml.ejs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

const scanDirs =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : [process.cwd()];
const baseDir = process.cwd();
let warnings = 0;

function scan(dir) {
  // Cycle-safe walk via the shared helper (#1521): walkRepo prunes vendor trees and never
  // recurses into a symlinked directory. Re-apply this script's own SKIP_DIRS as a path-segment
  // filter so the visited set is identical, minus the symlink-cycle bug. Unreadable dirs are
  // skipped silently.
  for (const rel of walkRepo(resolve(dir))) {
    if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (SCAN_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
      scanFile(join(dir, rel));
    }
  }
}

function hasGuard(lines, hitIndex) {
  const start = Math.max(0, hitIndex - CONTEXT_LINES);
  const end = Math.min(lines.length - 1, hitIndex + CONTEXT_LINES);
  for (let i = start; i <= end; i++) {
    if (PIPEFAIL_RE.test(lines[i]) || PIPESTATUS_RE.test(lines[i])) return true;
  }
  return false;
}

function scanFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    process.stderr.write(
      `  [warn] could not read file ${filePath}: ${err.message}\n`,
    );
    return;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PIPE_TEE_RE.test(lines[i]) && !hasGuard(lines, i)) {
      const rel = relative(baseDir, filePath);
      console.log(
        `  [WARN] ${rel}:${i + 1}  unguarded pipe/tee — add set -o pipefail or check PIPESTATUS[0]`,
      );
      warnings++;
    }
  }
}

for (const dir of scanDirs) {
  scan(dir);
}

if (warnings > 0) {
  console.log(
    `\n  Found ${warnings} advisory warning(s). Consider adding pipefail guards.\n`,
  );
}
// Always exit 0 — advisory only
process.exit(0);
