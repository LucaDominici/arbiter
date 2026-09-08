// SPDX-License-Identifier: Apache-2.0
//
// #2328 — engine-side verification of the gate-pass marker.
// #2427 — extended with the start/end run-identity axis (schema v3): a marker
// whose gate started on one tree and finished on another is unverifiable, not
// merely stale.
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
  schema: 'arbiter-gate-pass-v3',
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
    // #2427 — identity as it stood when the gate STARTED. Presence is checked
    // before any comparison, so a v2 marker is rejected rather than silently
    // losing the axis.
    'gate_started_at',
    'start_head_sha',
    'start_tree_hash',
  ] as readonly string[],
  /** Repo-resident toolchain identity, hashed by content — never by `--version`. */
  /** Fixed cross-language superset — see scripts/lib/gate-evidence.mjs. */
  toolchainInputs: [
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
  ] as readonly string[],
} as const

interface GatePassVerifyOptions {
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

type GatePassVerifyResult = { ok: true } | { ok: false; reason: string }

function gitLine(root: string, args: readonly string[]): string | null {
  try {
    // runCli returns only on success and throws CliError otherwise, so there is
    // no non-zero exit to test for here — the catch below is the failure path.
    const result = runCli('git', [...args], { cwd: root, timeoutMs: 15_000 })
    const out = result.stdout.trim()
    return out === '' ? null : out
    // Null propagates to "unverifiable" at every call site — `advance` refuses the
    // phase rather than accepting the marker. Rethrowing would turn an unresolvable
    // fact into a crash instead of a refusal.
    // FAIL-OPEN-INTENT: null is the REJECTING value, not a default.
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
    // Writer and verifier must agree on ONE spelling of the checkout root, so there
    // is deliberately no un-realpath'd fallback here.
    // FAIL-OPEN-INTENT: null rejects (the checkout_root axis reports unverifiable).
  } catch {
    return null
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
    runCli('git', ['add', '-A'], { cwd: top, env, timeoutMs: 60_000 })
    // Drop `.arbiter/` from the throwaway index rather than excluding it via
    // pathspec: `git add -- ':(exclude).arbiter'` names the path explicitly and
    // errors out in every repo that gitignores its own runtime state.
    runCli('git', ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '.arbiter'], {
      cwd: top,
      env,
      timeoutMs: 30_000,
    })
    const written = runCli('git', ['write-tree'], { cwd: top, env, timeoutMs: 15_000 })
    const out = written.stdout.trim()
    return out === '' ? null : out
    // identityProblem turns null into "gate-pass marker unverifiable: tree hash does
    // not resolve" — a refusal, checked in this same file, not a downstream promise.
    // FAIL-OPEN-INTENT: null means "tree unhashable" and is rejected by its caller here.
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

/** Gate level: an unknown level is never "good enough". */
function levelProblem(fields: Record<string, unknown>, minLevel: string): string | null {
  const level = String(fields.level)
  const rank = GATE_PASS_POLICY.levelRank[level]
  const required = GATE_PASS_POLICY.levelRank[minLevel]
  if (rank === undefined) return `gate-pass marker level "${level}" is not a known gate level`
  if (required === undefined) {
    return `required gate level "${minLevel}" is not a known gate level`
  }
  if (rank < required) {
    return `gate-pass marker level "${level}" is below the required "${minLevel}"`
  }
  return null
}

/** Age. A marker may NARROW the consumer budget with its own ttl, never widen it. */
function agingProblem(
  fields: Record<string, unknown>,
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

/**
 * #2427 — a gate that did not measure ONE tree from start to finish proves
 * nothing about either tree. The writer (scripts/lib/gate-evidence.mjs) refuses
 * to emit such a marker; this is the engine's independent second line.
 */
function startEndProblem(fields: Record<string, unknown>): string | null {
  if (fields.start_head_sha !== fields.head_sha) {
    return (
      'gate-pass marker is unverifiable: the gate started on commit ' +
      `"${String(fields.start_head_sha)}" and finished on "${String(fields.head_sha)}" — it did not ` +
      'measure one tree from start to finish'
    )
  }
  if (fields.start_tree_hash !== fields.tree_hash) {
    return (
      'gate-pass marker is unverifiable: the working tree changed while the gate ran ' +
      `(started at tree "${String(fields.start_tree_hash)}", finished at "${String(fields.tree_hash)}")`
    )
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
 * Verify a gate-pass marker against the tree it claims to describe.
 *
 * Ordered cheapest-first, and shape FIRST so a missing or blank field is a
 * rejection before any comparison can read it as unconstrained. Never throws.
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
  const checks: Array<() => string | null> = [
    () => shapeProblem(fields),
    () => levelProblem(fields, opts.minLevel ?? 'L2'),
    () =>
      agingProblem(
        fields,
        opts.maxAgeMin ?? GATE_PASS_POLICY.defaultTtlMinutes,
        opts.now ?? Date.now(),
      ),
    () => commitProblem(root, fields, opts.taskId),
    () => identityProblem(root, fields),
    // LAST on purpose: commit/identity answer "does this marker describe THIS
    // tree", start↔end answers "did one gate measure ONE tree". A marker that
    // fails both deserves the first, more specific, diagnosis.
    () => startEndProblem(fields),
  ]

  for (const check of checks) {
    const reason = check()
    if (reason !== null) return { ok: false, reason }
  }
  return { ok: true }
}
