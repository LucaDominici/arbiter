#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// #2328 — identity binding for the gate-pass marker (`.arbiter/gate-pass.json`).
//
// Binding gate evidence to `head_sha` + branch + a boolean tree-clean snapshot
// leaves three ways for a green marker to describe a tree that was never gated:
//
//   * no tree identity     — a boolean says the tree *was* clean, never *what
//                            it contained*, and it ignores untracked files;
//   * no checkout identity — sibling worktrees share one `.git` common dir and
//                            one branch namespace, so a marker can be honoured
//                            from a checkout that never ran the gate;
//   * no toolchain identity — a changed lockfile or a reinstalled node_modules
//                            leaves the marker valid.
//
// #2427 added the fourth: no RUN identity. Every axis above is sampled when the
// marker is STAMPED, so a gate that ran for twenty minutes against one tree and
// finished after the branch moved stamped the NEW head_sha and the NEW tree hash
// — a marker binding a tree it never tested. Schema v3 therefore records the
// identity captured at gate START alongside the one measured at gate END, the
// writer refuses to emit a marker when they disagree (or when either end is
// unresolvable), and the verifier reads a disagreement as unverifiable.
//
// Every axis fails CLOSED, and — the load-bearing rule — a MISSING or EMPTY
// field is never read as "unconstrained": the required fields are checked for
// presence before anything is compared, so a marker written under an older
// schema is rejected rather than grandfathered.
//
// TRUST BOUNDARY (unchanged from #2085): the marker is a plain JSON file a
// local process could forge. This binds evidence to a tree, it does not
// authenticate the writer. CI re-runs the full gate independently.
//
// Consumed by scripts/check-all.mjs (writer), .claude/hooks/enforce-gate-before-pr.mjs,
// .claude/hooks/stop-evidence-guard.mjs, and .githooks/pre-push through the
// `verify` CLI at the bottom of this file. The arbiter engine deliberately
// carries its own copy of this policy (src/evidence/gate-binding.ts): a command
// that gates a tree must not take its verdict from a script inside that tree.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMainModule } from './run-helpers.mjs'

export const GATE_EVIDENCE_SCHEMA = 'arbiter-gate-pass-v3'
export const GATE_EVIDENCE_DEFAULT_TTL_MIN = 240
export const GATE_EVIDENCE_LEVEL_RANK = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3 })

/** Fields that must be present AND non-blank before any comparison happens. */
export const GATE_EVIDENCE_STRING_FIELDS = Object.freeze([
  'schema',
  'head_sha',
  'branch',
  'task_id',
  'timestamp',
  'level',
  'node_version',
  'tree_hash',
  'checkout_root',
  'toolchain_fingerprint',
  // #2427 — identity as it stood when the gate STARTED. Present-and-non-blank is
  // checked before anything is compared, so a v2 marker (which has no start at
  // all) is a rejection rather than a marker whose start axis silently vanishes.
  'gate_started_at',
  'start_head_sha',
  'start_tree_hash',
])

// Repo-resident toolchain identity, hashed by CONTENT — never by `--version`
// output, which is chatty, PATH-sensitive and identical across a swapped
// binary. `node_modules/.package-lock.json` is npm's hidden lockfile: it
// describes the tree that is actually INSTALLED (versions + integrity), so a
// reinstall that diverges from package-lock.json is caught too.
//
// The interpreter binary is deliberately NOT hashed. `process.execPath` is not
// stable across the four consumers — a sanitized environment resolves `node`
// to /usr/bin/node while an interactive shell resolves it to the version
// manager's build — so hashing it would turn the gate permanently red instead
// of catching anything. `node_version` covers the interpreter axis and is
// compared separately by verifyGateEvidence.
// arbiter ships this verifier into Java/Python/Go/Rust projects too, so the
// list is a fixed CROSS-LANGUAGE superset: a Node-only list would make the
// fingerprint the constant sha256(absent, absent, …) in every non-Node repo —
// an axis that can never flip red, which is the very failure this issue is
// about. An absent file contributes an `absent` sentinel, so the list stays
// deterministic across all four consumers whatever the project is.
export const GATE_EVIDENCE_TOOLCHAIN_INPUTS = Object.freeze([
  // Node
  'package.json',
  'package-lock.json',
  'node_modules/.package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.nvmrc',
  // Java
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle/wrapper/gradle-wrapper.properties',
  // Python
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'requirements.txt',
  'requirements-dev.txt',
  // Go
  'go.mod',
  'go.sum',
  // Rust
  'Cargo.toml',
  'Cargo.lock',
])

/** Clock skew tolerated before a marker counts as stamped in the future. */
export const GATE_EVIDENCE_FUTURE_SKEW_MIN = 2

/**
 * One line of git output, or null when git cannot answer.
 *
 * FAIL-OPEN-INTENT: null is a REJECTION, not a default. Every caller treats it
 * as "this fact is unresolvable": buildGateEvidence writes no marker at all and
 * verifyGateEvidence returns `unverifiable`. Rethrowing here would abort the
 * gate run / crash a Claude Code hook (exit 1 = NON-blocking) instead, which is
 * the strictly weaker outcome.
 */
function gitLine(root, args, env = process.env) {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out === '' ? null : out
    // Null propagates to "no marker" (writer) or "unverifiable" (verifier); neither
    // path accepts evidence. Rethrowing would instead abort the gate run or crash a
    // Claude Code hook (exit 1 = NON-blocking), which is the strictly weaker outcome.
    // FAIL-OPEN-INTENT: null is the REJECTING value, not a default.
  } catch {
    return null
  }
}

/** Physical path of the checkout `root` belongs to, symlinks resolved. */
export function computeCheckoutRoot(root) {
  const top = gitLine(root, ['rev-parse', '--show-toplevel'])
  if (top === null) return null
  try {
    return realpathSync(top)
    // Writer and verifier must agree on ONE spelling of the checkout root, so there
    // is deliberately no un-realpath'd fallback here.
    // FAIL-OPEN-INTENT: null rejects at both ends (no marker / unverifiable).
  } catch {
    return null
  }
}

/**
 * Content identity of the WORKING TREE — tracked, staged and untracked-but-not
 * -ignored files alike — as a git tree object written through a throwaway
 * index, so neither the real index nor HEAD is touched.
 *
 * `.arbiter/` is excluded: it is arbiter's own runtime state (the marker being
 * written lives there), and including it would make the stamp invalidate
 * itself. Committed content under `.arbiter/` is still covered by `head_sha`.
 */
export function computeTreeHash(root) {
  const top = computeCheckoutRoot(root)
  if (top === null) return null
  let indexDir = null
  try {
    indexDir = mkdtempSync(join(tmpdir(), 'arbiter-tree-index-'))
    const env = { ...process.env, GIT_INDEX_FILE: join(indexDir, 'index') }
    execFileSync('git', ['add', '-A'], { cwd: top, env, stdio: 'ignore' })
    // Drop `.arbiter/` from the throwaway index rather than excluding it via
    // pathspec: `git add -- ':(exclude).arbiter'` names the path explicitly and
    // errors out ("paths are ignored by one of your .gitignore files") in every
    // repo that gitignores its own runtime state — which is the normal case.
    execFileSync('git', ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '.arbiter'], {
      cwd: top,
      env,
      stdio: 'ignore',
    })
    return gitLine(top, ['write-tree'], env)
    // buildGateEvidence refuses to emit a marker AT ALL when this is null — its
    // null-guard is the local guarantee (proven by "refuses to build evidence when
    // the tree hash cannot be computed"), so the safety does not live downstream.
    // The verifier independently reports `unverifiable`. No path treats it as a match.
    // FAIL-OPEN-INTENT: null means "tree unhashable" and is rejected by its caller here.
  } catch {
    return null
  } finally {
    if (indexDir !== null) rmSync(indexDir, { recursive: true, force: true })
  }
}

/** sha256 over the BYTES of the repo-resident toolchain inputs, in fixed order. */
export function computeToolchainFingerprint(root) {
  const top = computeCheckoutRoot(root) ?? root
  const outer = createHash('sha256')
  for (const rel of GATE_EVIDENCE_TOOLCHAIN_INPUTS) {
    const path = join(top, ...rel.split('/'))
    let entry = 'absent'
    try {
      if (existsSync(path)) {
        entry = createHash('sha256').update(readFileSync(path)).digest('hex')
      }
      // The 'unreadable' sentinel can never equal a real sha256, so an unreadable
      // input makes the fingerprint MISMATCH and the marker is rejected. Skipping the
      // entry instead would be the real fail-open: it silently shrinks the axis.
      // FAIL-OPEN-INTENT: the sentinel is the rejecting value.
    } catch {
      entry = 'unreadable'
    }
    outer.update(`${rel}\n${entry}\n`)
  }
  return `sha256:${outer.digest('hex')}`
}

/** Tracked-tree cleanliness at run time; untracked ('??') ignored, errors → false. */
function treeWasClean(root) {
  try {
    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return porcelain.split('\n').every((line) => line === '' || line.startsWith('??'))
    // verifyGateEvidence requires tree_was_clean_at_run_time === true, so a stamp
    // that cannot prove cleanliness is never honoured.
    // FAIL-OPEN-INTENT: false is the REJECTING value.
  } catch {
    return false
  }
}

/** A non-blank string, or `fallback`. */
function orFallback(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/** A positive finite number, or `fallback`. */
function orPositive(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * #2427 — the identity of the tree a gate is ABOUT to measure, captured before
 * its first check runs.
 *
 * `buildGateEvidence` used to sample head_sha and tree_hash at STAMP time only,
 * which is why an orphaned gate could run for twenty minutes against one tree,
 * see the branch move underneath it, and then stamp a green marker naming the
 * tree it had never tested. Whatever a gate measures, it must have started
 * measuring it.
 *
 * Returns null when either fact is unresolvable — never a partial start, because
 * a half-known start is indistinguishable downstream from no start at all.
 */
export function captureGateStart(root) {
  const headSha = gitLine(root, ['rev-parse', 'HEAD'])
  const treeHash = computeTreeHash(root)
  if (headSha === null || treeHash === null) return null
  return { head_sha: headSha, tree_hash: treeHash, started_at: new Date().toISOString() }
}

/**
 * Build a schema-v3 marker for `root`. Returns null when any identity fact is
 * unresolvable — a marker that cannot prove what it describes is never written.
 *
 * `start` is the REQUIRED output of `captureGateStart(root)` taken before the
 * first check ran. The marker is refused outright when it is absent, incomplete,
 * or disagrees with the identity re-measured here at the end. Fail-closed in
 * every direction: a gate that cannot prove it measured ONE tree from start to
 * finish stamps nothing, and a green gate with no marker is honest where a
 * marker for an unknown tree is not.
 */
export function buildGateEvidence({ root, level, taskId, ttlMinutes, start } = {}) {
  const facts = {
    checkoutRoot: computeCheckoutRoot(root),
    headSha: gitLine(root, ['rev-parse', 'HEAD']),
    branch: gitLine(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    treeHash: computeTreeHash(root),
  }
  if (Object.values(facts).some((fact) => fact === null)) return null

  // The whole point of #2427: end identity must equal start identity.
  if (typeof start !== 'object' || start === null) return null
  const startedAt = start.started_at
  if (typeof startedAt !== 'string' || startedAt.trim() === '') return null
  if (start.head_sha !== facts.headSha || start.tree_hash !== facts.treeHash) return null

  return {
    schema: GATE_EVIDENCE_SCHEMA,
    head_sha: facts.headSha,
    branch: facts.branch,
    gate_started_at: startedAt,
    start_head_sha: start.head_sha,
    start_tree_hash: start.tree_hash,
    task_id: orFallback(taskId, 'unknown'),
    timestamp: new Date().toISOString(),
    level: orFallback(level, 'unknown'),
    ttl_minutes: orPositive(ttlMinutes, GATE_EVIDENCE_DEFAULT_TTL_MIN),
    node_version: process.version,
    git_user: gitLine(root, ['config', 'user.name']) ?? 'unknown',
    checkout_root: facts.checkoutRoot,
    tree_hash: facts.treeHash,
    toolchain_fingerprint: computeToolchainFingerprint(root),
    tree_was_clean_at_run_time: treeWasClean(root),
  }
}

/**
 * Presence FIRST: an absent or blank field must never read as unconstrained,
 * which is what makes a pre-v2 marker a rejection rather than a free pass.
 */
function shapeProblem(marker) {
  for (const field of GATE_EVIDENCE_STRING_FIELDS) {
    const value = marker[field]
    if (typeof value !== 'string' || value.trim() === '') {
      return (
        `gate-pass marker field "${field}" is missing or empty — evidence from an older ` +
        'arbiter is not honoured; re-run the gate to stamp a current marker'
      )
    }
  }
  if (marker.schema !== GATE_EVIDENCE_SCHEMA) {
    return `gate-pass marker schema mismatch: expected "${GATE_EVIDENCE_SCHEMA}", got "${marker.schema}"`
  }
  if (marker.tree_was_clean_at_run_time !== true) {
    return 'gate-pass marker tree_was_clean_at_run_time must be true'
  }
  return null
}

/** Gate level: an unknown level is never "good enough". */
function levelProblem(marker, minLevel) {
  const rank = GATE_EVIDENCE_LEVEL_RANK[marker.level]
  const required = GATE_EVIDENCE_LEVEL_RANK[minLevel]
  if (rank === undefined) {
    return `gate-pass marker level "${marker.level}" is not a known gate level`
  }
  if (required === undefined) return `required gate level "${minLevel}" is not a known gate level`
  if (rank < required) {
    return `gate-pass marker level "${marker.level}" is below the required "${minLevel}"`
  }
  return null
}

/** Age. A marker may NARROW the consumer budget with its own ttl, never widen it. */
function agingProblem(marker, maxAgeMin, now) {
  if (!Number.isFinite(maxAgeMin) || maxAgeMin <= 0) {
    return `gate-pass age budget must be a positive number, got ${JSON.stringify(maxAgeMin)}`
  }
  const ttl = marker.ttl_minutes
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
    return `gate-pass marker ttl_minutes must be a positive finite number, got ${JSON.stringify(ttl)}`
  }

  const stampedAt = Date.parse(marker.timestamp)
  if (!Number.isFinite(stampedAt)) {
    return `gate-pass marker timestamp is not a valid date: "${marker.timestamp}"`
  }
  const ageMin = (now - stampedAt) / 60_000
  if (ageMin < -GATE_EVIDENCE_FUTURE_SKEW_MIN) {
    return `gate-pass marker timestamp is in the future: "${marker.timestamp}"`
  }
  const budget = Math.min(maxAgeMin, ttl)
  if (ageMin > budget) {
    return `gate-pass marker expired: ${Math.round(ageMin)} min old, budget ${budget} min`
  }
  return null
}

/** Commit, branch and task correlation (the #1441 anti-replay axis included). */
function commitProblem(root, marker, taskId) {
  const head = gitLine(root, ['rev-parse', 'HEAD'])
  if (head === null) return 'gate-pass marker unverifiable: HEAD does not resolve'
  if (marker.head_sha !== head) {
    return `gate-pass marker head_sha mismatch: expected "${head}", got "${marker.head_sha}"`
  }

  const branch = gitLine(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) return 'gate-pass marker unverifiable: branch does not resolve'
  if (marker.branch !== branch) {
    return `gate-pass marker branch mismatch: expected "${branch}", got "${marker.branch}"`
  }

  if (typeof taskId === 'string' && taskId.trim() !== '' && marker.task_id !== taskId) {
    return `gate-pass marker task_id "${marker.task_id}" does not match the current task "${taskId}" (anti-replay)`
  }
  return null
}

/**
 * #2427 — the axis that catches a gate which did not measure one tree.
 *
 * A marker whose start and end identities disagree describes a run that saw the
 * tree change underneath it; nothing it reports can be attributed to either
 * tree, so it is UNVERIFIABLE rather than merely stale. The writer already
 * refuses to emit one, so this is the second line of defence: it also rejects a
 * marker that was hand-edited or produced by a writer that skipped the refusal.
 */
function startEndProblem(marker) {
  if (marker.start_head_sha !== marker.head_sha) {
    return (
      'gate-pass marker is unverifiable: the gate started on commit ' +
      `"${marker.start_head_sha}" and finished on "${marker.head_sha}" — it did not ` +
      'measure one tree from start to finish'
    )
  }
  if (marker.start_tree_hash !== marker.tree_hash) {
    return (
      'gate-pass marker is unverifiable: the working tree changed while the gate ran ' +
      `(started at tree "${marker.start_tree_hash}", finished at "${marker.tree_hash}")`
    )
  }
  return null
}

/** The three axes #2328 added: checkout, toolchain and working-tree content. */
function identityProblem(root, marker) {
  if (marker.node_version !== process.version) {
    return `gate-pass marker node_version mismatch: expected "${process.version}", got "${marker.node_version}"`
  }

  const checkoutRoot = computeCheckoutRoot(root)
  if (checkoutRoot === null) {
    return 'gate-pass marker unverifiable: checkout root does not resolve'
  }
  if (marker.checkout_root !== checkoutRoot) {
    return (
      `gate-pass marker checkout_root mismatch: evidence was produced in "${marker.checkout_root}", ` +
      `this checkout is "${checkoutRoot}" — evidence does not travel between worktrees`
    )
  }

  if (marker.toolchain_fingerprint !== computeToolchainFingerprint(root)) {
    return (
      'gate-pass marker toolchain_fingerprint mismatch — a lockfile or the installed ' +
      'toolchain changed since the gate ran'
    )
  }

  const treeHash = computeTreeHash(root)
  if (treeHash === null) return 'gate-pass marker unverifiable: tree hash does not resolve'
  if (marker.tree_hash !== treeHash) {
    return 'gate-pass marker tree_hash mismatch — the working tree changed since the gate ran'
  }
  return null
}

/**
 * Verify a marker against the tree it claims to describe.
 *
 * Ordered cheapest-first, and shape FIRST so a missing or blank field is a
 * rejection before any comparison can read it as unconstrained.
 *
 * @returns `{ ok: true }` or `{ ok: false, reason }` — never throws.
 */
export function verifyGateEvidence(marker, opts = {}) {
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    return { ok: false, reason: 'gate-pass marker must be a JSON object' }
  }
  const root = opts.root ?? process.cwd()
  const checks = [
    () => shapeProblem(marker),
    () => levelProblem(marker, opts.minLevel ?? 'L2'),
    () =>
      agingProblem(
        marker,
        Number(opts.maxAgeMin ?? GATE_EVIDENCE_DEFAULT_TTL_MIN),
        typeof opts.now === 'number' ? opts.now : Date.now(),
      ),
    () => commitProblem(root, marker, opts.taskId),
    () => identityProblem(root, marker),
    // LAST on purpose: commit/identity answer "does this marker describe THIS
    // tree", start↔end answers "did one gate measure ONE tree". A marker that
    // fails both deserves the first, more specific, diagnosis.
    () => startEndProblem(marker),
  ]

  for (const check of checks) {
    const reason = check()
    if (reason !== null) return { ok: false, reason }
  }
  return { ok: true }
}

/** Read + verify in one step; a missing or unparseable marker fails closed. */
export function verifyGateEvidenceFile(markerPath, opts = {}) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(markerPath, 'utf-8'))
    // A missing or corrupt marker is refused, with the parse error surfaced verbatim
    // to the caller in the rejection reason.
    // FAIL-OPEN-INTENT: not a swallow — this catch RETURNS A REJECTION.
  } catch (err) {
    return { ok: false, reason: `gate-pass marker unreadable at ${markerPath}: ${err.message}` }
  }
  return verifyGateEvidence(parsed, opts)
}

// ── CLI: `node scripts/lib/gate-evidence.mjs verify [flags]` ────────────────
// Exit 0 + a one-line summary on stdout when the evidence binds; exit 1 + the
// reason on stderr otherwise. `.githooks/pre-push` consumes this.
function flag(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1 || index + 1 >= argv.length) return fallback
  return argv[index + 1]
}

function main(argv) {
  if (argv[0] !== 'verify') {
    process.stderr.write('usage: gate-evidence.mjs verify [--root d] [--min-level L2]')
    process.stderr.write(' [--max-age-min n] [--task-id id] [--marker path]\n')
    process.exit(2)
  }
  const root = flag(argv, 'root', process.cwd())
  const markerPath = flag(argv, 'marker', join(root, '.arbiter', 'gate-pass.json'))
  const result = verifyGateEvidenceFile(markerPath, {
    root,
    minLevel: flag(argv, 'min-level', 'L2'),
    maxAgeMin: Number(flag(argv, 'max-age-min', GATE_EVIDENCE_DEFAULT_TTL_MIN)),
    taskId: flag(argv, 'task-id', undefined),
  })
  if (!result.ok) {
    process.stderr.write(`${result.reason}\n`)
    process.exit(1)
  }
  const marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
  const ageMin = Math.round((Date.now() - Date.parse(marker.timestamp)) / 60_000)
  process.stdout.write(
    `${marker.level} evidence for ${String(marker.head_sha).slice(0, 12)} (verified ${ageMin} min ago)`,
  )
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2))
