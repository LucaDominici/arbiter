#!/usr/bin/env node
// check-bloat-ratchet.mjs — file-count + LOC ratchet for src/ (CANON-16, INV-46)
// Bootstrap: if .bloat-baseline.json missing → write snapshot, exit 0.
// Compare: fail if any bucket grows >threshold% OR >N files vs baseline.
// Bypass: ALLOW_BLOAT=1 env var (intentional escape hatch, session-scoped).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { BLOAT_BUCKETS, countBucketPaths, snapshotBuckets } from './bloat-lib.mjs'

if (process.env.ALLOW_BLOAT === '1') {
  process.stdout.write('[bloat] ALLOW_BLOAT=1 — skipping ratchet check\n')
  process.exit(0)
}

const cwd = process.cwd()
const BASELINE_FILE = resolve(cwd, '.bloat-baseline.json')

// ─── Measure current state ────────────────────────────────────────────────────
function snapshot() {
  return snapshotBuckets(cwd)
}

const current = snapshot()

// ─── Bootstrap ────────────────────────────────────────────────────────────────
if (!existsSync(BASELINE_FILE)) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ capturedAt: new Date().toISOString(), buckets: current }, null, 2) + '\n',
    'utf-8',
  )
  process.stdout.write('[bloat] baseline initialized → .bloat-baseline.json\n')
  process.exit(0)
}

// ─── Load baseline ────────────────────────────────────────────────────────────
let baseline
try {
  baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'))
} catch (err) {
  process.stderr.write(`[bloat] ERROR: malformed .bloat-baseline.json: ${err.message}\n`)
  process.exit(1)
}

// ─── Compare ──────────────────────────────────────────────────────────────────
const violations = []

for (const [bucket, { thresholds: thr }] of Object.entries(BLOAT_BUCKETS)) {
  const base = baseline.buckets?.[bucket]
  const cur = current[bucket]
  if (!base) continue

  const fileDelta = cur.files - base.files
  const filePct = base.files > 0 ? ((cur.files - base.files) / base.files) * 100 : 0
  const locPct = base.loc > 0 ? ((cur.loc - base.loc) / base.loc) * 100 : 0

  if (fileDelta > thr.files) {
    violations.push(
      `  ${bucket}: +${fileDelta} files (limit +${thr.files}); baseline=${base.files}, current=${cur.files}`,
    )
  }
  if (filePct > thr.pct) {
    violations.push(
      `  ${bucket}: +${filePct.toFixed(1)}% file growth (limit ${thr.pct}%); baseline=${base.files}, current=${cur.files}`,
    )
  }
  if (locPct > thr.pct) {
    violations.push(
      `  ${bucket}: +${locPct.toFixed(1)}% LOC growth (limit ${thr.pct}%); baseline=${base.loc} loc, current=${cur.loc} loc`,
    )
  }
}

// ponytail: ceiling — merge-result LOC is intentionally not measured because it needs blob reads;
// upgrade via `git cat-file --batch` if merge-result LOC becomes necessary.
function gitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    // FAIL-OPEN-INTENT: callers surface the unavailable Git state as an explicit non-applicable merge-result check; repositories without origin/main are valid.
  } catch {
    return null
  }
}

function hasMergeResultToCheck() {
  const originMain = gitOutput(['rev-parse', '--verify', '--quiet', 'origin/main'])
  if (originMain === null) {
    process.stdout.write('[bloat] merge result check skipped: origin/main does not exist\n')
    return false
  }
  if (gitOutput(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']) !== null) {
    process.stdout.write('[bloat] merge result check skipped: HEAD already contains origin/main\n')
    return false
  }
  return true
}

function mergeResultPaths() {
  const tree = gitOutput(['merge-tree', '--write-tree', 'origin/main', 'HEAD'])
  if (!tree || !/^[0-9a-f]{40,64}$/.test(tree)) {
    process.stdout.write(
      '[bloat] merge result check skipped: merge tree unavailable or conflicted\n',
    )
    return null
  }
  const paths = gitOutput(['ls-tree', '-r', '--name-only', tree])
  if (paths === null) {
    process.stdout.write('[bloat] merge result check skipped: could not list merge tree\n')
    return null
  }
  return paths ? paths.split('\n') : []
}

function recordMergeResultViolations(paths) {
  const counts = countBucketPaths(paths)
  for (const [bucket, { thresholds: thr }] of Object.entries(BLOAT_BUCKETS)) {
    const base = baseline.buckets?.[bucket]
    if (!base) continue
    const delta = counts[bucket] - base.files
    const pct = base.files > 0 ? (delta / base.files) * 100 : 0
    if (delta > thr.files || pct > thr.pct) {
      violations.push(
        `  merge result ${bucket}: +${delta} files (limit +${thr.files}; ${pct.toFixed(1)}% growth, limit ${thr.pct}%); baseline=${base.files}, merge result=${counts[bucket]}`,
      )
    }
  }
}

function checkMergeResult() {
  if (!hasMergeResultToCheck()) return
  const paths = mergeResultPaths()
  if (paths === null) return
  recordMergeResultViolations(paths)
}

checkMergeResult()

if (violations.length > 0) {
  process.stderr.write('[bloat] RATCHET VIOLATION — src/ grew beyond baseline:\n')
  for (const v of violations) process.stderr.write(v + '\n')
  process.stderr.write(
    '[bloat] Fix: remove unused files, or run `node scripts/update-bloat-baseline.mjs --task=#NNN` to advance the baseline.\n' +
      '[bloat] Bypass: ALLOW_BLOAT=1 (session-scoped, documented in CONTRIBUTING.md).\n',
  )
  process.exit(1)
}

process.stdout.write('[bloat] ratchet OK\n')
