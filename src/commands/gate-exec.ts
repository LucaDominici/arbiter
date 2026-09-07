// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter gate-exec [--key K] -- <cmd...>` — per-repo gate mutex (#1873 T3, ADR-103).
 *
 * Serializes expensive gates across N parallel worktree agents of the SAME
 * repo. Deterministic leaf primitive (ADR-103 §2): no orchestration state, no
 * issue awareness — it derives a per-repo key, then delegates the blocking
 * acquisition to `flock(1)` while Node and a detached supervisor retain the
 * locked open-file description until the gate is safe to release:
 *
 *   - the wait is kernel-side and blocking (no poll, no backoff);
 *   - the supervisor runs `flock 3`, then launches the command from a subshell
 *     that closes fd 3 first, so no gated descendant inherits the mutex;
 *   - Node retains the same locked open-file description. If the supervisor is
 *     killed, Node kills its process group, then Linux procfs holders of a
 *     separate inherited sentinel fd, before closing the final safety copy;
 *   - residual limit: a payload that deliberately closes that sentinel fd
 *     before escaping the process group is no longer observable. On that path,
 *     or without Linux procfs, supervisor death can still release the mutex
 *     while the escaped payload runs;
 *   - Ctrl-C tears down the supervisor group and tracked descendants before Node
 *     releases its copy. A hard SIGKILL of Node still leaves the supervisor's
 *     copy held until the gate exits. `doctor` reports the mutex and its
 *     supervisor/holder/waiter count.
 *
 * Key: hash of `git rev-parse --git-common-dir` — every worktree of a repo
 * shares the main repo's common dir, so they converge on ONE lock. The lock
 * file lives OUTSIDE the repo ($XDG_RUNTIME_DIR/arbiter, fallback tmpdir):
 * per-worktree locks would be a null mutex, an in-repo lock would dirty trees.
 *
 * Fail-closed: platforms without `flock(1)` (macOS base system, Windows) get
 * E_GATE_MUTEX_UNSUPPORTED with a serial-fallback hint — NOT a silent lockfile
 * emulation, which would reintroduce the SIGKILL hole.
 *
 * Lock ordering (ADR-103 §4): gate-exec is a LEAF — it acquires only the gate
 * flock and must never be invoked while `.arbiter/.lock` is held. Total order:
 * gate-lock ≺ worktree-lock ≺ wave-claim.
 *
 * CANON-16 Existing Code Survey:
 *   - src/utils/file-lock.ts: lockfile-based try-or-fail mutex — wrong
 *     semantics here (no kernel release on SIGKILL, no queued wait); kept for
 *     its callers, bugfixed separately (T2).
 *   - src/utils/run-cli.ts: runInteractive inherits stdio, applies no timeout,
 *     and owns the process-group teardown used here (INV-12).
 */
import { existsSync } from 'node:fs'
import {
  closeDescriptorTranslated,
  ensureDir,
  openAppendDescriptorTranslated,
  unlinkTranslated,
} from '../utils/fs.js'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCli, runInteractive, CliError } from '../utils/run-cli.js'
import { ArbiterError } from '../utils/errors.js'

/** Derive the per-repo mutex key: short hash of the resolved git common dir. */
export function deriveGateKey(dir: string): string {
  const commonDir = runCli('git', ['rev-parse', '--git-common-dir'], { cwd: dir }).stdout.trim()
  // --git-common-dir may be relative (e.g. ".git" from the repo root).
  const absolute = resolve(dir, commonDir)
  return createHash('sha256').update(absolute).digest('hex').slice(0, 16)
}

/**
 * Lock file path for a key: `$XDG_RUNTIME_DIR/arbiter/<key>-gate.lock`,
 * falling back to the OS tmpdir when XDG_RUNTIME_DIR is unset. Creates the
 * parent directory. NEVER inside the repo (see module doc).
 */
export function gateLockPath(key: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = env['XDG_RUNTIME_DIR'] ?? tmpdir()
  const dir = join(base, 'arbiter')
  ensureDir(dir)
  return join(dir, `${key}-gate.lock`)
}

/**
 * Fail-closed capability probe: `flock(1)` must be runnable. Absent (or
 * unrunnable) → E_GATE_MUTEX_UNSUPPORTED with the serial-fallback hint.
 */
export function assertFlockAvailable(env: NodeJS.ProcessEnv = process.env): void {
  try {
    runCli('flock', ['--version'], { env, timeoutMs: 10_000 })
  } catch (e) {
    const detail = e instanceof CliError && e.notFound ? 'not found on PATH' : 'not runnable'
    throw ArbiterError.fromKey('E_GATE_MUTEX_UNSUPPORTED', 'errors.E_GATE_MUTEX_UNSUPPORTED', {
      detail,
    })
  }
}

/**
 * Direct-flock argv for compatibility and kernel contract tests. `runGateExec`
 * uses the supervised fd form below. `-o` is flock's own `--close` option and MUST precede `--`; it
 * closes the lock fd before the gate command is exec'd, preventing the command
 * and its descendants from retaining the mutex. `--` ends flock's option
 * parsing, so it takes everything after the lock file verbatim and child flags
 * (e.g. `npm test --run`) are never eaten by flock.
 */
export function gateExecArgv(lockPath: string, cmdArgs: readonly string[]): string[] {
  return ['flock', '-o', '--', lockPath, ...cmdArgs]
}

const CHILD_LOCK_FD = 3
const DESCENDANT_SENTINEL_FD = 4
const SUPERVISOR_SCRIPT =
  `exec ${DESCENDANT_SENTINEL_FD}>>"$1" || exit $?; shift; ` +
  `flock ${CHILD_LOCK_FD} || exit $?; (exec ${CHILD_LOCK_FD}>&-; exec "$@")`

export interface GateExecOptions {
  /** Command + args to run under the mutex (everything after `--`). */
  cmdArgs: readonly string[]
  /** Explicit mutex key — overrides per-repo derivation. */
  key?: string
  /** Target directory (defaults to cwd) — used for key derivation and as cwd. */
  dir?: string
}

/**
 * Advisory-only queue-depth check (#2098). Counts current holders/waiters on
 * `lockPath` via the target project's own generated `scripts/lib/waiter-count.mjs`
 * — the ONE shared implementation this shells out to rather than duplicating,
 * also used by `scripts/capacity-probe.mjs`. gate-exec.ts ships compiled into
 * dist/ WITHOUT scripts/ (see package.json "files"), so it cannot statically
 * import a file that only exists in a target project's own checked-out tree;
 * shelling out from `dir` (the target project) reaches the same file.
 *
 * Returns the advisory line once depth reaches >= 2 (this process about to
 * join the queue makes 3+), or null when the helper is absent/broken or the
 * queue is shallow. Never throws — this is UX, not the mutex itself.
 */
export function gateQueueAdvisory(dir: string, lockPath: string): string | null {
  const helperPath = resolve(dir, 'scripts', 'lib', 'waiter-count.mjs')
  if (!existsSync(helperPath)) return null
  try {
    const { stdout } = runCli('node', [helperPath, lockPath], { timeoutMs: 5_000 })
    const count = Number(stdout.trim())
    if (!Number.isFinite(count) || count < 2) return null
    return (
      `gate-exec: ${count} process(es) already queued on this mutex — CI is authoritative; ` +
      'consider pushing instead of waiting: ARBITER_PREPUSH_BYPASS=true ' +
      'ARBITER_PREPUSH_BYPASS_REASON="<reason>" git push (see docs/REFERENCE/api.md)'
    )
    // FAIL-OPEN-INTENT: advisory line — a broken/missing/timed-out helper must never block the mutex.
  } catch {
    return null
  }
}

/**
 * Run `cmdArgs` under the per-repo gate mutex. Blocks (kernel-side) until the
 * lock is free, inherits stdio, and returns the child's exit code verbatim.
 */
export async function runGateExec(opts: GateExecOptions): Promise<number> {
  const dir = opts.dir ?? process.cwd()
  assertFlockAvailable()
  const key = opts.key ?? deriveGateKey(dir)
  const lockPath = gateLockPath(key)
  process.stderr.write(`gate-exec: mutex ${lockPath} (blocking until free)\n`)
  const advisory = gateQueueAdvisory(dir, lockPath)
  if (advisory) process.stderr.write(`${advisory}\n`)
  const lockFd = openAppendDescriptorTranslated(lockPath)
  const sentinelPath = `${lockPath}.${process.pid}-${randomBytes(4).toString('hex')}.sentinel`
  try {
    const { exitCode } = await runInteractive(
      'sh',
      ['-c', SUPERVISOR_SCRIPT, 'gate-exec-supervisor', sentinelPath, ...opts.cmdArgs],
      {
        cwd: dir,
        // #2427: publish the mutex this process already holds so a gate that can
        // take the lock itself (`scripts/check-all.mjs`, `scripts/lib/gate-mutex.mjs`)
        // recognises it as already held and does not self-deadlock waiting on it.
        env: { ...process.env, ARBITER_GATE_MUTEX_HELD: lockPath },
        extraFds: [lockFd],
        detached: true,
        teardownProcessGroupOnSignal: true,
        teardownOnParentSignal: true,
        trackedDescendantFdPath: sentinelPath,
      },
    )
    return exitCode
  } finally {
    closeDescriptorTranslated(lockFd, lockPath)
    if (existsSync(sentinelPath)) unlinkTranslated(sentinelPath)
  }
}
