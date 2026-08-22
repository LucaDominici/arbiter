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

export const GATE_EVIDENCE_SCHEMA = 'arbiter-gate-pass-v2'
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
export const GATE_EVIDENCE_TOOLCHAIN_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'node_modules/.package-lock.json',
  '.nvmrc',
])

/** Clock skew tolerated before a marker counts as stamped in the future. */
const FUTURE_SKEW_MIN = 2

function gitLine(root, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out === '' ? null : out
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
  } catch {
    return top
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
    return gitLineWithEnv(top, ['write-tree'], env)
  } catch {
    return null
  } finally {
    if (indexDir !== null) rmSync(indexDir, { recursive: true, force: true })
  }
}

function gitLineWithEnv(root, args, env) {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out === '' ? null : out
  } catch {
    return null
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
  } catch {
    return false
  }
}

/**
 * Build a schema-v2 marker for `root`. Returns null when any identity fact is
 * unresolvable — a marker that cannot prove what it describes is never written.
 */
export function buildGateEvidence({ root, level, taskId, ttlMinutes } = {}) {
  const checkoutRoot = computeCheckoutRoot(root)
  const headSha = gitLine(root, ['rev-parse', 'HEAD'])
  const branch = gitLine(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const treeHash = computeTreeHash(root)
  if (checkoutRoot === null || headSha === null || branch === null || treeHash === null) return null

  const ttl = Number(ttlMinutes ?? GATE_EVIDENCE_DEFAULT_TTL_MIN)
  return {
    schema: GATE_EVIDENCE_SCHEMA,
    head_sha: headSha,
    branch,
    task_id: typeof taskId === 'string' && taskId.trim() !== '' ? taskId : 'unknown',
    timestamp: new Date().toISOString(),
    level: typeof level === 'string' && level.trim() !== '' ? level : 'unknown',
    ttl_minutes: Number.isFinite(ttl) && ttl > 0 ? ttl : GATE_EVIDENCE_DEFAULT_TTL_MIN,
    node_version: process.version,
    git_user: gitLine(root, ['config', 'user.name']) ?? 'unknown',
    checkout_root: checkoutRoot,
    tree_hash: treeHash,
    toolchain_fingerprint: computeToolchainFingerprint(root),
    tree_was_clean_at_run_time: treeWasClean(root),
  }
}

/**
 * Verify a marker against the tree it claims to describe.
 *
 * @returns `{ ok: true }` or `{ ok: false, reason }` — never throws.
 */
export function verifyGateEvidence(marker, opts = {}) {
  const root = opts.root ?? process.cwd()
  const minLevel = opts.minLevel ?? 'L2'
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const reject = (reason) => ({ ok: false, reason })

  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    return reject('gate-pass marker must be a JSON object')
  }

  // Presence FIRST: an absent or blank field must never read as unconstrained.
  for (const field of GATE_EVIDENCE_STRING_FIELDS) {
    const value = marker[field]
    if (typeof value !== 'string' || value.trim() === '') {
      return reject(
        `gate-pass marker field "${field}" is missing or empty — evidence from an older ` +
          'arbiter is not honoured; re-run the gate to stamp a current marker',
      )
    }
  }

  if (marker.schema !== GATE_EVIDENCE_SCHEMA) {
    return reject(
      `gate-pass marker schema mismatch: expected "${GATE_EVIDENCE_SCHEMA}", got "${marker.schema}"`,
    )
  }

  if (marker.tree_was_clean_at_run_time !== true) {
    return reject('gate-pass marker tree_was_clean_at_run_time must be true')
  }

  const budgetOpt = Number(opts.maxAgeMin ?? GATE_EVIDENCE_DEFAULT_TTL_MIN)
  if (!Number.isFinite(budgetOpt) || budgetOpt <= 0) {
    return reject(`gate-pass age budget must be a positive number, got ${JSON.stringify(budgetOpt)}`)
  }
  const ttl = marker.ttl_minutes
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
    return reject(
      `gate-pass marker ttl_minutes must be a positive finite number, got ${JSON.stringify(ttl)}`,
    )
  }
  // The marker may only NARROW the consumer's budget, never widen it.
  const budget = Math.min(budgetOpt, ttl)

  const rank = GATE_EVIDENCE_LEVEL_RANK[marker.level]
  const required = GATE_EVIDENCE_LEVEL_RANK[minLevel]
  if (rank === undefined) {
    return reject(`gate-pass marker level "${marker.level}" is not a known gate level`)
  }
  if (required === undefined) {
    return reject(`required gate level "${minLevel}" is not a known gate level`)
  }
  if (rank < required) {
    return reject(`gate-pass marker level "${marker.level}" is below the required "${minLevel}"`)
  }

  const stampedAt = Date.parse(marker.timestamp)
  if (!Number.isFinite(stampedAt)) {
    return reject(`gate-pass marker timestamp is not a valid date: "${marker.timestamp}"`)
  }
  const ageMin = (now - stampedAt) / 60_000
  if (ageMin < -FUTURE_SKEW_MIN) {
    return reject(`gate-pass marker timestamp is in the future: "${marker.timestamp}"`)
  }
  if (ageMin > budget) {
    return reject(`gate-pass marker expired: ${Math.round(ageMin)} min old, budget ${budget} min`)
  }

  const head = gitLine(root, ['rev-parse', 'HEAD'])
  if (head === null) return reject('gate-pass marker unverifiable: HEAD does not resolve')
  if (marker.head_sha !== head) {
    return reject(`gate-pass marker head_sha mismatch: expected "${head}", got "${marker.head_sha}"`)
  }

  const branch = gitLine(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) return reject('gate-pass marker unverifiable: branch does not resolve')
  if (marker.branch !== branch) {
    return reject(`gate-pass marker branch mismatch: expected "${branch}", got "${marker.branch}"`)
  }

  const taskId = opts.taskId
  if (typeof taskId === 'string' && taskId.trim() !== '' && marker.task_id !== taskId) {
    return reject(
      `gate-pass marker task_id "${marker.task_id}" does not match the current task "${taskId}" (anti-replay)`,
    )
  }

  if (marker.node_version !== process.version) {
    return reject(
      `gate-pass marker node_version mismatch: expected "${process.version}", got "${marker.node_version}"`,
    )
  }

  const checkoutRoot = computeCheckoutRoot(root)
  if (checkoutRoot === null) {
    return reject('gate-pass marker unverifiable: checkout root does not resolve')
  }
  if (marker.checkout_root !== checkoutRoot) {
    return reject(
      `gate-pass marker checkout_root mismatch: evidence was produced in "${marker.checkout_root}", ` +
        `this checkout is "${checkoutRoot}" — evidence does not travel between worktrees`,
    )
  }

  if (marker.toolchain_fingerprint !== computeToolchainFingerprint(root)) {
    return reject(
      'gate-pass marker toolchain_fingerprint mismatch — a lockfile or the installed ' +
        'toolchain changed since the gate ran',
    )
  }

  const treeHash = computeTreeHash(root)
  if (treeHash === null) return reject('gate-pass marker unverifiable: tree hash does not resolve')
  if (marker.tree_hash !== treeHash) {
    return reject('gate-pass marker tree_hash mismatch — the working tree changed since the gate ran')
  }

  return { ok: true }
}

/** Read + verify in one step; a missing or unparseable marker fails closed. */
export function verifyGateEvidenceFile(markerPath, opts = {}) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(markerPath, 'utf-8'))
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
