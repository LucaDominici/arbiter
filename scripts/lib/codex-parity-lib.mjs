// SPDX-License-Identifier: Apache-2.0
// scripts/lib/codex-parity-lib.mjs — pure helpers for the codex-track parity
// contract (ADR-106, #1966). No process.exit, no spawns, no repo mutation:
// every function operates on explicit inputs so unit tests can drive each
// check against isolated fixtures (never the live worktree).
//
// Classification model (ADR-106): every file emitted under a track root gets
// exactly ONE class — DERIVED (generated from the canonical Claude source,
// normalized byte-equality required), ALLOWLISTED (intentional divergence,
// pinned by content hashes of both sides), or BY-DESIGN-EXCLUSIVE (declared
// one-track-only surface). Unclassified or multi-classified files are gate
// failures: parity-surface coverage must be 100%.
//
// Consumed by scripts/check-codex-parity.mjs (the gate check) and by
// __tests__/scripts/check-codex-parity.test.ts (unit + mutation fixtures).

import { readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { minimatch } from 'minimatch'

// ─── Parity classes ──────────────────────────────────────────────────────────

export const CLASS_DERIVED = 'DERIVED'
export const CLASS_ALLOWLISTED = 'ALLOWLISTED'
export const CLASS_EXCLUSIVE = 'BY-DESIGN-EXCLUSIVE'

// ─── Track roots (baked-project-relative) ────────────────────────────────────

// Claude track root vs Codex track roots. The parity surface is the union of
// every file found under these directories in a real bake (hardening 2:
// independent denominator — filesystem scan, then reconciled against the
// generated manifest so registry-omitted files become visible, not invisible).
export const TRACK_ROOTS = Object.freeze({
  claude: ['.claude'],
  codex: ['.agents', '.codex'],
})

// ─── Derived pairs (codex file ← canonical claude source) ────────────────────

// The 5 shared rules the Codex track derives from the canonical Claude rule
// templates (ADR-106 derive-from-Claude model). `golden` names the committed,
// independently reviewed oracle under __tests__/fixtures/codex-parity/golden/
// (hardening 6: generator output is compared TO the golden, never
// generated-vs-generated in the same run).
export const DERIVED_PAIRS = Object.freeze(
  [
    '05-agent-lifecycle.md',
    '25-todo-folder-policy.md',
    '50-batch-execution.md',
    '60-incidental-capture.md',
    '90-exec-protocol.md',
  ].map((name) => ({
    codex: `.agents/rules/${name}`,
    claude: `.claude/rules/${name}`,
    golden: `rules/${name}.golden`,
  })),
)

// The CANON-22 heading whose silent loss from the Codex track is the #1966
// motivating incident. Exported so tests target the exact section.
export const CANON22_HEADING = '## Root-Cause Discipline (CANON-22)'

// ─── Small utilities ─────────────────────────────────────────────────────────

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

/**
 * Scoped normalization (hardening 5): ONLY named front-matter fields and
 * explicitly supplied interpolation values are normalized. Semantic whitespace
 * (Markdown indent, code fences, YAML) is preserved so a semantic-whitespace
 * divergence stays visible (red), and legitimate prose that merely mentions an
 * agent name is left untouched unless that exact value was passed in
 * `interpolations`.
 *
 * opts.frontMatterFields — field names whose front-matter VALUE is replaced
 *   with the stable token `<normalized>` (default: ['agent']).
 * opts.interpolations — exact strings (generator interpolation values, e.g. a
 *   project name) replaced with `<normalized>` throughout the body.
 */
export function normalizeContent(text, opts = {}) {
  const fields = opts.frontMatterFields ?? ['agent']
  const interpolations = opts.interpolations ?? []
  let out = normalizeFrontMatter(text, fields)
  for (const value of interpolations) {
    if (typeof value === 'string' && value.length > 0) {
      out = out.split(value).join('<normalized>')
    }
  }
  return out
}

function normalizeFrontMatter(text, fields) {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---', 4)
  if (end === -1) return text
  const head = text.slice(0, end)
  const tail = text.slice(end)
  const normalizedHead = head
    .split('\n')
    .map((line) => {
      for (const field of fields) {
        if (line.startsWith(`${field}:`)) return `${field}: <normalized>`
      }
      return line
    })
    .join('\n')
  return normalizedHead + tail
}

// ─── Filesystem scan (hardening 16: bake-scan spec) ─────────────────────────

/**
 * Walk the track roots of a baked project directory. Deterministic (sorted),
 * lstat semantics: a symlink is recorded as an entry, its target is never
 * followed. `exclusions` is a list of minimatch patterns (relative posix
 * paths) from the schema-validated exclusion list.
 *
 * Returns { claude: string[], codex: string[] } of baked-dir-relative posix
 * paths.
 */
export function scanTrackRoots(bakedDir, exclusions = []) {
  const result = { claude: [], codex: [] }
  for (const [track, roots] of Object.entries(TRACK_ROOTS)) {
    for (const root of roots) {
      walkDir(bakedDir, root, exclusions, result[track])
    }
    result[track].sort()
  }
  return result
}

function walkDir(baseDir, rel, exclusions, out) {
  const abs = join(baseDir, rel)
  let stat
  try {
    stat = lstatSync(abs)
  } catch {
    return // root absent in this bake — surfaced by baseline/manifest checks
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    if (!isExcluded(rel, exclusions)) out.push(rel)
    return
  }
  for (const entry of readdirSync(abs).sort()) {
    walkDir(baseDir, `${rel}/${entry}`, exclusions, out)
  }
}

function isExcluded(rel, exclusions) {
  return exclusions.some((pattern) => minimatch(rel, pattern, { dot: true }))
}

// ─── Data-file loading ───────────────────────────────────────────────────────

/** Read+parse a JSON data file; returns undefined when absent. */
export function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf-8'))
}

// ─── Checks (implemented in the GREEN phase of #1966) ───────────────────────
// Each stub below currently reports NO findings; the RED-phase test
// (CANON-22 drop on an isolated fixture) must fail against this skeleton,
// proving the eventual green is earned by the real implementation.

/** Classify every scanned file into exactly one parity class. */
export function classifyFiles(_scan, _ctx) {
  return { classes: new Map(), findings: [] }
}

/** Compare each DERIVED pair (normalized) and against its committed golden. */
export function compareDerivedPairs(_bakedDir, _ctx) {
  return []
}

/** Reconcile the filesystem scan against the generated manifest (hardening 2). */
export function reconcileScanWithManifest(_scan, _manifestFiles) {
  return []
}

/** Validate allowlist entries: current on both sides, no healed/stale pins. */
export function checkAllowlistEntries(_bakedDir, _allowlist) {
  return []
}

/** Known Limitations table ↔ actual baked Claude hook inventory (hardening 8). */
export function checkKnownLimitations(_codexMdText, _scannedHooks, _infra) {
  return []
}

/** Baseline identity + anti-shrinkage vs merge-base baseline (hardening 3/14). */
export function checkBaseline(_scan, _committedBaseline, _mergeBaseBaseline) {
  return []
}

/** Schema validators for the scripts/data/codex-parity-*.json files. */
export function validateAllowlist(_x) {
  return []
}
export function validateExclusive(_x) {
  return []
}
export function validateBaseline(_x) {
  return []
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Run the full parity check over a baked project directory.
 *
 * opts:
 *   bakedDir            — baked fixture project root (required)
 *   manifestFiles       — baked-dir-relative paths from the generated manifest
 *   allowlist/exclusive/baseline — parsed data-file contents
 *   mergeBaseBaseline   — baseline JSON as of merge-base, or 'BOOTSTRAP'
 *   goldensDir          — committed golden fixtures root
 *
 * Returns { status: 'PASS'|'FAIL', findings: [{kind, file, message}],
 *           surface: { total, classified } }.
 */
export function runParityCheck(opts) {
  const scan = scanTrackRoots(opts.bakedDir, opts.exclusions ?? [])
  const total = scan.claude.length + scan.codex.length
  // Skeleton (#1966 harness): real checks land in the GREEN phase.
  return { status: 'PASS', findings: [], surface: { total, classified: 0 } }
}
