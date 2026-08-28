#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: verifies the declared agent-dispatch oracle matches the actual review-dispatch derivation.
// CATALOG: rejected fold-in into check-tier-coverage.mjs because that asserts CI tier→runner coverage (workflow YAML), a different domain from the (tier×track×review_mode×pr_type) review oracle.
// CATALOG: rejected fold-in into check-constraint-scan.mjs because that turns CLAUDE.md prohibitions into grep enforcers; this replays a JSON oracle against compiled tier-floor logic — distinct inputs and comparison.
// check-agent-dispatch.mjs — agent-dispatch-verify gate (#1267).
//
// Asserts the DECLARED tier->vertical floor (.claude/agent-dispatch-matrix.json) matches
// the ACTUAL derivation task-ship.ts produces, so route-auditors.mjs's `--size-floor`
// input can never silently drift from the ship lifecycle's own floor table.
//
// Checks:
//   1. Structural validation of the matrix JSON (required keys, axis coverage,
//      modifier-vocabulary subset of the declared verticals).
//   2. Tier-floor parity: matrix.tier_verticals[tier] === task-ship.ts::verticalsForTier(tier)
//      for EVERY declared tier. task-ship.ts is the pure mirror; the matrix is the SSOT
//      route-auditors.mjs reads. A planted mismatch here (e.g. dropping 'security' from
//      Standard) makes this gate exit non-zero (AC4).
//
// The pure floor mirror is imported from the COMPILED dist (scripts/ cannot import .ts).
// Build (npm run build) must run before this gate — the L1 gate builds the kit first.
//
// #1817 (B-prune) — the old multi-pass/pass-count review_pass_count axis parity check
// (vs. the now-deleted src/review/tier-constants.ts) was removed with the multi-pass
// review dispatch subsystem (B2). tier_verticals parity is the sole surviving check.
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
  'track_modifiers',
  'pr_type_modifiers',
  'model_diversity',
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

// ── 2. Tier-floor parity vs the pure task-ship mirror (the core anti-drift check) ─
let verticalsForTier
let reviewAgentsForTier
let externalSlotsForTier
try {
  const shipUrl = pathToFileURL(join(REPO_ROOT, 'dist', 'commands', 'task-ship.js')).href
  ;({ verticalsForTier, reviewAgentsForTier } = await import(shipUrl))
  const reviewUrl = pathToFileURL(
    join(REPO_ROOT, 'dist', 'integrations', 'external-review.js'),
  ).href
  ;({ externalSlotsForTier } = await import(reviewUrl))
} catch (e) {
  invoke(`cannot import compiled dispatch mirrors — run "npm run build": ${e.message}`)
}
if (typeof verticalsForTier !== 'function') {
  invoke('dist/commands/task-ship.js does not export verticalsForTier')
}
if (typeof reviewAgentsForTier !== 'function') {
  invoke('dist/commands/task-ship.js does not export reviewAgentsForTier')
}
if (typeof externalSlotsForTier !== 'function') {
  invoke('dist/integrations/external-review.js does not export externalSlotsForTier')
}

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
for (const tier of matrix.axes.tier) {
  const declared = matrix.tier_verticals[tier]
  if (!Array.isArray(declared)) fail(`tier_verticals.${tier} missing or not an array`)
  let mirror
  try {
    mirror = verticalsForTier(tier)
  } catch (e) {
    invoke(`verticalsForTier("${tier}") threw: ${e.message}`)
  }
  if (!eq(declared, mirror)) {
    fail(
      `tier_verticals.${tier} drift: matrix declares [${declared.join(', ')}] but ` +
        `task-ship.ts::verticalsForTier("${tier}") yields [${mirror.join(', ')}]. ` +
        `The matrix JSON is the SSOT; update task-ship.ts (or the matrix) so they agree.`,
    )
  }
}

// ── 3. Model-diversity parity (#2358) ──────────────────────────────────────
for (const tier of matrix.axes.tier) {
  const declared = matrix.model_diversity[tier]
  if (!Number.isInteger(declared) || declared < 0) {
    fail(`model_diversity.${tier} missing or not a non-negative integer in matrix`)
  }
  let external
  let reviewAgents
  try {
    external = externalSlotsForTier(tier)
    reviewAgents = reviewAgentsForTier(tier)
  } catch (e) {
    invoke(`dispatch slot derivation for tier "${tier}" threw: ${e.message}`)
  }
  if (declared > reviewAgents) {
    fail(`model_diversity.${tier} declares ${declared}, above REVIEW_AGENTS=${reviewAgents}`)
  }
  if (declared !== external) {
    fail(
      `model_diversity.${tier} drift: matrix declares ${declared} but ` +
        `externalSlotsForTier("${tier}") yields ${external}`,
    )
  }
}

// ── 4. Refutation-skeptics parity (M13 #1943) ───────────────────────────────
// The refutation skill's documented N table (.claude/skills/refutation/SKILL.md) MUST equal
// the matrix `refutation_skeptics` block — N is declared, not improvised (M1/M10). A drift
// here means the skill dispatches a different skeptic count than the dispatch SSOT promises.
if (matrix.refutation_skeptics) {
  const skillPath = join(matrixRoot, '.claude', 'skills', 'refutation', 'SKILL.md')
  if (!existsSync(skillPath)) {
    fail(`matrix declares refutation_skeptics but skill not found at ${skillPath}`)
  }
  let skillSrc
  try {
    skillSrc = readFileSync(skillPath, 'utf-8')
  } catch (e) {
    invoke(`cannot read refutation skill ${skillPath}: ${e.message}`)
  }
  for (const tier of matrix.axes.tier) {
    const declaredN = matrix.refutation_skeptics[tier]
    if (!Number.isInteger(declaredN)) {
      fail(`refutation_skeptics.${tier} missing or not an integer in matrix`)
    }
    // The skill documents N as a markdown table row: `| <tier> | <N> |`.
    const re = new RegExp(`\\|\\s*${tier}\\s*\\|\\s*(\\d+)\\s*\\|`)
    const m = skillSrc.match(re)
    if (!m) {
      fail(`refutation skill ${skillPath} has no N-table row for tier "${tier}"`)
    }
    if (Number(m[1]) !== declaredN) {
      fail(
        `refutation_skeptics.${tier} drift: matrix declares ${declaredN} but skill documents ${m[1]}. ` +
          `The matrix is the SSOT; update the skill N table (or the matrix) so they agree.`,
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
