#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: verifies the declared agent-dispatch oracle matches the actual review-dispatch derivation.
// CATALOG: rejected fold-in into check-tier-coverage.mjs because that asserts CI tier→runner coverage (workflow YAML), a different domain from the (tier×track×review_mode×pr_type) review oracle.
// CATALOG: rejected fold-in into check-constraint-scan.mjs because that turns CLAUDE.md prohibitions into grep enforcers; this replays a JSON oracle against compiled sizing logic — distinct inputs and comparison.
// check-agent-dispatch.mjs — agent-dispatch-verify gate (#1267).
//
// Asserts the DECLARED agent-dispatch oracle (.claude/agent-dispatch-matrix.json) matches
// the ACTUAL derivation the review machinery produces, eliminating the last self-judgement
// in review dispatch. The matrix is independent of the selection code, so this comparison
// is non-circular: it catches any drift between the declared table and the real logic.
//
// Checks:
//   1. Structural validation of the matrix JSON (required keys, axis coverage,
//      modifier-vocabulary subset of the declared verticals).
//   2. Tier-floor parity: matrix.tier_verticals[tier] === src/sizing/sizing.ts::sizeVerticals(tier)
//      for EVERY tier the sizing module knows. sizing.ts is the pure mirror; the matrix is the
//      SSOT route-auditors.mjs now reads. A planted mismatch here (e.g. dropping 'security'
//      from Standard) makes this gate exit non-zero (AC4).
//   3. review_pass_count axis coverage: every (review_mode, tier) present.
//
// The pure sizing mirror is imported from the COMPILED dist (scripts/ cannot import .ts).
// Build (npm run build) must run before this gate — the L1 gate builds the kit first.
//
// Flags:
//   --matrix-root <dir>  read the matrix JSON from <dir>/.claude/ instead of CWD (test seam).
//
// Exit codes: 0 = declared matches actual; 1 = drift/validation failure; 2 = invocation error.
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
let matrixRoot = process.cwd()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--matrix-root' && args[i + 1]) matrixRoot = resolve(args[++i])
}

const REPO_ROOT = process.cwd()
const MATRIX_PATH = join(matrixRoot, '.claude', 'agent-dispatch-matrix.json')

function fail(msg) {
  process.stderr.write(`[check-agent-dispatch] FAIL: ${msg}\n`)
  process.exit(1)
}

function invoke(msg) {
  process.stderr.write(`[check-agent-dispatch] ERROR: ${msg}\n`)
  process.exit(2)
}

// ── Load matrix (fail-loud) ──────────────────────────────────────────────────
if (!existsSync(MATRIX_PATH)) fail(`matrix not found: ${MATRIX_PATH}`)
let matrix
try {
  matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf-8'))
} catch (e) {
  fail(`invalid JSON in ${MATRIX_PATH}: ${e.message}`)
}

// ── 1. Structural validation ─────────────────────────────────────────────────
const REQUIRED = [
  'axes',
  'tier_verticals',
  'review_pass_count',
  'track_modifiers',
  'pr_type_modifiers',
]
for (const k of REQUIRED) {
  if (!(k in matrix)) fail(`missing required key "${k}"`)
}
for (const a of ['tier', 'track', 'review_mode', 'pr_type']) {
  if (!Array.isArray(matrix.axes?.[a]) || matrix.axes[a].length === 0) {
    fail(`axes.${a} must be a non-empty array`)
  }
}

// The universe of valid vertical names = union of all tier_verticals values.
const verticalUniverse = new Set()
for (const list of Object.values(matrix.tier_verticals)) {
  for (const v of list) verticalUniverse.add(v)
}
// Every track/pr_type modifier vertical must be a declared vertical (no free text).
for (const [grp, label] of [
  [matrix.track_modifiers, 'track_modifiers'],
  [matrix.pr_type_modifiers, 'pr_type_modifiers'],
]) {
  for (const [name, list] of Object.entries(grp)) {
    if (!Array.isArray(list)) fail(`${label}.${name} must be an array`)
    for (const v of list) {
      if (!verticalUniverse.has(v)) {
        fail(`${label}.${name} references undeclared vertical "${v}" (not in any tier_verticals)`)
      }
    }
  }
}
// Every declared axis track/pr_type must have a modifier entry (coverage).
for (const t of matrix.axes.track) {
  if (!(t in matrix.track_modifiers)) fail(`track_modifiers missing entry for axis track "${t}"`)
}
for (const p of matrix.axes.pr_type) {
  if (!(p in matrix.pr_type_modifiers))
    fail(`pr_type_modifiers missing entry for axis pr_type "${p}"`)
}

// ── 3. review_pass_count axis coverage ───────────────────────────────────────
for (const mode of matrix.axes.review_mode) {
  const perTier = matrix.review_pass_count?.[mode]
  if (perTier === undefined) fail(`review_pass_count missing review_mode "${mode}"`)
  for (const tier of matrix.axes.tier) {
    if (typeof perTier[tier] !== 'number') {
      fail(`review_pass_count.${mode}.${tier} missing or non-numeric`)
    }
  }
}

// ── 2. Tier-floor parity vs the pure sizing mirror (the core anti-drift check) ─
let sizeVerticals
try {
  const sizingUrl = pathToFileURL(join(REPO_ROOT, 'dist', 'sizing', 'sizing.js')).href
  ;({ sizeVerticals } = await import(sizingUrl))
} catch (e) {
  invoke(
    `cannot import compiled sizing mirror (dist/sizing/sizing.js) — run "npm run build": ${e.message}`,
  )
}
if (typeof sizeVerticals !== 'function') {
  invoke('dist/sizing/sizing.js does not export sizeVerticals')
}

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
for (const tier of matrix.axes.tier) {
  const declared = matrix.tier_verticals[tier]
  if (!Array.isArray(declared)) fail(`tier_verticals.${tier} missing or not an array`)
  let mirror
  try {
    mirror = sizeVerticals(tier)
  } catch (e) {
    invoke(`sizeVerticals("${tier}") threw: ${e.message}`)
  }
  if (!eq(declared, mirror)) {
    fail(
      `tier_verticals.${tier} drift: matrix declares [${declared.join(', ')}] but ` +
        `sizing.ts::sizeVerticals("${tier}") yields [${mirror.join(', ')}]. ` +
        `The matrix JSON is the SSOT; update sizing.ts (or the matrix) so they agree.`,
    )
  }
}

// ── 4. review_pass_count value parity vs tier-constants.ts (#1662) ────────────
// The matrix re-declares the same per-tier review-pass numbers that the REAL
// dispatcher reads from src/review/tier-constants.ts (TIER_PASS_COUNT drives the
// plan-review pass loop; TIER_REVIEWER_COUNT drives the code-review persona count).
// Without this cross-check the two SSOTs can silently drift — mirror the existing
// tier_verticals mirror check for the pass-count axis.
let TIER_PASS_COUNT, TIER_REVIEWER_COUNT
try {
  const constsUrl = pathToFileURL(join(REPO_ROOT, 'dist', 'review', 'tier-constants.js')).href
  ;({ TIER_PASS_COUNT, TIER_REVIEWER_COUNT } = await import(constsUrl))
} catch (e) {
  invoke(
    `cannot import compiled tier-constants (dist/review/tier-constants.js) — run "npm run build": ${e.message}`,
  )
}
if (!TIER_PASS_COUNT || !TIER_REVIEWER_COUNT) {
  invoke('dist/review/tier-constants.js does not export TIER_PASS_COUNT / TIER_REVIEWER_COUNT')
}
const PASS_SOURCES = {
  plan: ['TIER_PASS_COUNT', TIER_PASS_COUNT],
  code: ['TIER_REVIEWER_COUNT', TIER_REVIEWER_COUNT],
}
for (const tier of matrix.axes.tier) {
  for (const [mode, [srcName, srcMap]] of Object.entries(PASS_SOURCES)) {
    const declared = matrix.review_pass_count[mode]?.[tier]
    const actual = srcMap[tier]
    if (declared !== actual) {
      fail(
        `review_pass_count.${mode}.${tier} drift: matrix declares ${declared} but ` +
          `tier-constants.ts::${srcName}.${tier} is ${actual}. ` +
          `tier-constants.ts is the SSOT; update the matrix (or the constant) so they agree.`,
      )
    }
  }
}

process.stdout.write(
  `[check-agent-dispatch] OK — dispatch matrix matches actual derivation ` +
    `(${matrix.axes.tier.length} tiers × ${matrix.axes.track.length} tracks × ` +
    `${matrix.axes.review_mode.length} modes × ${matrix.axes.pr_type.length} pr_types)\n`,
)
process.exit(0)
