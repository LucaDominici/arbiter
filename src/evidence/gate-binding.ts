// SPDX-License-Identifier: Apache-2.0
//
// #2328 — engine-side verification of the gate-pass marker.
//
// `arbiter task advance` must NOT delegate its verdict to a script that lives
// inside the tree it is gating: anyone who can edit `scripts/lib/gate-evidence.mjs`
// would otherwise make `advance` pass forever. The engine therefore carries its
// own copy of the same policy. `GATE_PASS_POLICY` is the shared contract and is
// pinned against the script's constants by
// `__tests__/evidence/gate-evidence-binding.test.ts`, so the two copies cannot
// drift into a gate that validates nothing.
//
// See scripts/lib/gate-evidence.mjs for the rationale behind each axis.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempTranslated, rmTranslated } from '../utils/fs.js'
import { runCli } from '../utils/run-cli.js'

export const GATE_PASS_POLICY = {
  schema: 'arbiter-gate-pass-v2',
  defaultTtlMinutes: 240,
  /** Clock skew tolerated before a marker counts as stamped in the future. */
  futureSkewMinutes: 2,
  levelRank: { L0: 0, L1: 1, L2: 2, L3: 3 } as Readonly<Record<string, number>>,
  /** Must be present AND non-blank before any comparison happens. */
  stringFields: [
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
  ] as readonly string[],
  /** Repo-resident toolchain identity, hashed by content — never by `--version`. */
  toolchainInputs: [
    'package.json',
    'package-lock.json',
    'node_modules/.package-lock.json',
    '.nvmrc',
  ] as readonly string[],
} as const

export interface GatePassVerifyOptions {
  /** Directory inside the checkout the evidence must describe. */
  root: string
  /** Lowest gate level the caller accepts (default `L2`). */
  minLevel?: string
  /** Consumer age budget in minutes; a marker may narrow it, never widen it. */
  maxAgeMin?: number
  /** When set, the marker must belong to this task (anti-replay, #1441). */
  taskId?: string
  /** Injectable clock, for tests. */
  now?: number
}

export type GatePassVerifyResult = { ok: true } | { ok: false; reason: string }

function gitLine(root: string, args: readonly string[]): string | null {
  try {
    const result = runCli('git', [...args], { cwd: root, timeoutMs: 15_000 })
    if (result.exitCode !== 0) return null
    const out = result.stdout.trim()
    return out === '' ? null : out
  } catch {
    return null
  }
}

/** Physical path of the checkout `root` belongs to, symlinks resolved. */
function checkoutRootOf(root: string): string | null {
  const top = gitLine(root, ['rev-parse', '--show-toplevel'])
  if (top === null) return null
  try {
    return realpathSync(top)
  } catch {
    return top
  }
}

/**
 * Content identity of the working tree, written through a throwaway index so
 * neither the real index nor HEAD is touched. `.arbiter/` is excluded: it holds
 * arbiter's own runtime state, including the marker being verified.
 */
function treeHashOf(root: string): string | null {
  const top = checkoutRootOf(root)
  if (top === null) return null
  let indexDir: string | null = null
  try {
    indexDir = mkdtempTranslated(join(tmpdir(), 'arbiter-tree-index-'))
    const env = { ...process.env, GIT_INDEX_FILE: join(indexDir, 'index') }
    const staged = runCli('git', ['add', '-A'], { cwd: top, env, timeoutMs: 60_000 })
    if (staged.exitCode !== 0) return null
    // Drop `.arbiter/` from the throwaway index rather than excluding it via
    // pathspec: `git add -- ':(exclude).arbiter'` names the path explicitly and
    // errors out in every repo that gitignores its own runtime state.
    const dropped = runCli('git', ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '.arbiter'], {
      cwd: top,
      env,
      timeoutMs: 30_000,
    })
    if (dropped.exitCode !== 0) return null
    const written = runCli('git', ['write-tree'], { cwd: top, env, timeoutMs: 15_000 })
    if (written.exitCode !== 0) return null
    const out = written.stdout.trim()
    return out === '' ? null : out
  } catch {
    return null
  } finally {
    if (indexDir !== null) rmTranslated(indexDir, { recursive: true, force: true })
  }
}

/** sha256 over the BYTES of the repo-resident toolchain inputs, in fixed order. */
function toolchainFingerprintOf(root: string): string {
  const top = checkoutRootOf(root) ?? root
  const outer = createHash('sha256')
  for (const rel of GATE_PASS_POLICY.toolchainInputs) {
    const path = join(top, ...rel.split('/'))
    let entry = 'absent'
    try {
      if (existsSync(path)) entry = createHash('sha256').update(readFileSync(path)).digest('hex')
    } catch {
      entry = 'unreadable'
    }
    outer.update(`${rel}\n${entry}\n`)
  }
  return `sha256:${outer.digest('hex')}`
}

/**
 * Presence FIRST: an absent or blank field must never read as unconstrained,
 * which is what makes a pre-v2 marker a rejection rather than a free pass.
 */
function shapeProblem(fields: Record<string, unknown>): string | null {
  for (const field of GATE_PASS_POLICY.stringFields) {
    const value = fields[field]
    if (typeof value !== 'string' || value.trim() === '') {
      return (
        `gate-pass marker field "${field}" is missing or empty — evidence from an older ` +
        'arbiter is not honoured; re-run the gate to stamp a current marker'
      )
    }
  }
  if (fields.schema !== GATE_PASS_POLICY.schema) {
    return `gate-pass marker schema mismatch: expected "${GATE_PASS_POLICY.schema}", got "${String(fields.schema)}"`
  }
  if (fields.tree_was_clean_at_run_time !== true) {
    return 'gate-pass marker tree_was_clean_at_run_time must be true'
  }
  return null
}

/** Level ranking and age. A marker may NARROW the consumer budget, never widen it. */
function freshnessProblem(
  fields: Record<string, unknown>,
  minLevel: string,
  maxAgeMin: number,
  now: number,
): string | null {
  if (!Number.isFinite(maxAgeMin) || maxAgeMin <= 0) {
    return `gate-pass age budget must be a positive number, got ${JSON.stringify(maxAgeMin)}`
  }
  const ttl = fields.ttl_minutes
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
    return `gate-pass marker ttl_minutes must be a positive finite number, got ${JSON.stringify(ttl)}`
  }

  const level = String(fields.level)
  const rank = GATE_PASS_POLICY.levelRank[level]
  const required = GATE_PASS_POLICY.levelRank[minLevel]
  if (rank === undefined) return `gate-pass marker level "${level}" is not a known gate level`
  if (required === undefined) return `required gate level "${minLevel}" is not a known gate level`
  if (rank < required) {
    return `gate-pass marker level "${level}" is below the required "${minLevel}"`
  }

  const timestamp = String(fields.timestamp)
  const stampedAt = Date.parse(timestamp)
  if (!Number.isFinite(stampedAt)) {
    return `gate-pass marker timestamp is not a valid date: "${timestamp}"`
  }
  const ageMin = (now - stampedAt) / 60_000
  if (ageMin < -GATE_PASS_POLICY.futureSkewMinutes) {
    return `gate-pass marker timestamp is in the future: "${timestamp}"`
  }
  const budget = Math.min(maxAgeMin, ttl)
  if (ageMin > budget) {
    return `gate-pass marker expired: ${Math.round(ageMin)} min old, budget ${budget} min`
  }
  return null
}

/** Commit, branch and task correlation (the #1441 anti-replay axis included). */
function commitProblem(
  root: string,
  fields: Record<string, unknown>,
  taskId: string | undefined,
): string | null {
  const head = gitLine(root, ['rev-parse', 'HEAD'])
  if (head === null) return 'gate-pass marker unverifiable: HEAD does not resolve'
  if (fields.head_sha !== head) {
    return `gate-pass marker head_sha mismatch: expected "${head}", got "${String(fields.head_sha)}"`
  }

  const branch = gitLine(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) return 'gate-pass marker unverifiable: branch does not resolve'
  if (fields.branch !== branch) {
    return `gate-pass marker branch mismatch: expected "${branch}", got "${String(fields.branch)}"`
  }

  if (typeof taskId === 'string' && taskId.trim() !== '' && fields.task_id !== taskId) {
    return `gate-pass marker task_id "${String(fields.task_id)}" does not match the current task "${taskId}" (anti-replay)`
  }
  return null
}

/** The three axes #2328 added: checkout, toolchain and working-tree content. */
function identityProblem(root: string, fields: Record<string, unknown>): string | null {
  if (fields.node_version !== process.version) {
    return `gate-pass marker node_version mismatch: expected "${process.version}", got "${String(fields.node_version)}"`
  }

  const checkoutRoot = checkoutRootOf(root)
  if (checkoutRoot === null) {
    return 'gate-pass marker unverifiable: checkout root does not resolve'
  }
  if (fields.checkout_root !== checkoutRoot) {
    return (
      `gate-pass marker checkout_root mismatch: evidence was produced in "${String(fields.checkout_root)}", ` +
      `this checkout is "${checkoutRoot}" — evidence does not travel between worktrees`
    )
  }

  if (fields.toolchain_fingerprint !== toolchainFingerprintOf(root)) {
    return (
      'gate-pass marker toolchain_fingerprint mismatch — a lockfile or the installed ' +
      'toolchain changed since the gate ran'
    )
  }

  const treeHash = treeHashOf(root)
  if (treeHash === null) return 'gate-pass marker unverifiable: tree hash does not resolve'
  if (fields.tree_hash !== treeHash) {
    return 'gate-pass marker tree_hash mismatch — the working tree changed since the gate ran'
  }
  return null
}

/**
 * Verify a gate-pass marker against the tree it claims to describe. Never
 * throws; every axis fails closed, and a missing or blank field is rejected
 * rather than treated as unconstrained.
 */
export function verifyGatePassMarker(
  marker: unknown,
  opts: GatePassVerifyOptions,
): GatePassVerifyResult {
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    return { ok: false, reason: 'gate-pass marker must be a JSON object' }
  }
  const fields = marker as Record<string, unknown>
  const { root } = opts

  const reason =
    shapeProblem(fields) ??
    freshnessProblem(
      fields,
      opts.minLevel ?? 'L2',
      opts.maxAgeMin ?? GATE_PASS_POLICY.defaultTtlMinutes,
      opts.now ?? Date.now(),
    ) ??
    commitProblem(root, fields, opts.taskId) ??
    identityProblem(root, fields)

  return reason === null ? { ok: true } : { ok: false, reason }
}
