#!/usr/bin/env node
// check-bloat-ratchet.mjs — file-count + LOC ratchet for src/ (CANON-16, INV-46)
// Bootstrap: if .bloat-baseline.json missing → write snapshot, exit 0.
// Compare: fail if any bucket grows >threshold% OR >N files vs baseline.
// Bypass: ALLOW_BLOAT=1 env var (intentional escape hatch, session-scoped).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { countFiles, countFilesShallow, countLOC } from "./bloat-lib.mjs";

if (process.env.ALLOW_BLOAT === "1") {
  process.stdout.write("[bloat] ALLOW_BLOAT=1 — skipping ratchet check\n");
  process.exit(0);
}

const cwd = process.cwd();
const BASELINE_FILE = resolve(cwd, ".bloat-baseline.json");
const EXTS = [".ts", ".mjs", ".js"];

// ─── Measure current state ────────────────────────────────────────────────────
function snapshot() {
  return {
    srcDirect: {
      files: countFilesShallow(resolve(cwd, "src"), EXTS),
      loc: countLOC(resolve(cwd, "src"), EXTS, false),
    },
    generators: {
      files: countFiles(resolve(cwd, "src/generators"), EXTS),
      loc: countLOC(resolve(cwd, "src/generators"), EXTS),
    },
    commands: {
      files: countFiles(resolve(cwd, "src/commands"), EXTS),
      loc: countLOC(resolve(cwd, "src/commands"), EXTS),
    },
    templates: {
      files: countFiles(resolve(cwd, "src/templates"), [
        ".ejs",
        ".ts",
        ".mjs",
        ".js",
      ]),
      loc: countLOC(resolve(cwd, "src/templates"), [
        ".ejs",
        ".ts",
        ".mjs",
        ".js",
      ]),
    },
  };
}

const current = snapshot();

// ─── Bootstrap ────────────────────────────────────────────────────────────────
if (!existsSync(BASELINE_FILE)) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      { capturedAt: new Date().toISOString(), buckets: current },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  process.stdout.write("[bloat] baseline initialized → .bloat-baseline.json\n");
  process.exit(0);
}

// ─── Load baseline ────────────────────────────────────────────────────────────
let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf-8"));
} catch (err) {
  process.stderr.write(
    `[bloat] ERROR: malformed .bloat-baseline.json: ${err.message}\n`,
  );
  process.exit(1);
}

// ─── Thresholds ───────────────────────────────────────────────────────────────
// src/templates gets tighter limits (jscpd can't scan EJS — extra vigilance)
const THRESHOLDS = {
  srcDirect: { pct: 10, files: 5 },
  generators: { pct: 10, files: 5 },
  commands: { pct: 10, files: 5 },
  templates: { pct: 5, files: 3 },
};

// ─── Compare ──────────────────────────────────────────────────────────────────
const violations = [];

for (const [bucket, thr] of Object.entries(THRESHOLDS)) {
  const base = baseline.buckets?.[bucket];
  const cur = current[bucket];
  if (!base) continue;

  const fileDelta = cur.files - base.files;
  const filePct =
    base.files > 0 ? ((cur.files - base.files) / base.files) * 100 : 0;
  const locPct = base.loc > 0 ? ((cur.loc - base.loc) / base.loc) * 100 : 0;

  if (fileDelta > thr.files) {
    violations.push(
      `  ${bucket}: +${fileDelta} files (limit +${thr.files}); baseline=${base.files}, current=${cur.files}`,
    );
  }
  if (filePct > thr.pct) {
    violations.push(
      `  ${bucket}: +${filePct.toFixed(1)}% file growth (limit ${thr.pct}%); baseline=${base.files}, current=${cur.files}`,
    );
  }
  if (locPct > thr.pct) {
    violations.push(
      `  ${bucket}: +${locPct.toFixed(1)}% LOC growth (limit ${thr.pct}%); baseline=${base.loc} loc, current=${cur.loc} loc`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(
    "[bloat] RATCHET VIOLATION — src/ grew beyond baseline:\n",
  );
  for (const v of violations) process.stderr.write(v + "\n");
  process.stderr.write(
    "[bloat] Fix: remove unused files, or run `node scripts/update-bloat-baseline.mjs --task=#NNN` to advance the baseline.\n" +
      "[bloat] Bypass: ALLOW_BLOAT=1 (session-scoped, documented in CONTRIBUTING.md).\n",
  );
  process.exit(1);
}

process.stdout.write("[bloat] ratchet OK\n");
