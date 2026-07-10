// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter gate-exec [--key K] -- <cmd...>` — per-repo gate mutex (#1873 T3, ADR-103).
 *
 * Serializes expensive gates across N parallel worktree agents of the SAME
 * repo. Deterministic leaf primitive (ADR-103 §2): no orchestration state, no
 * issue awareness — it derives a per-repo key, then delegates the wait AND the
 * release to `flock(1)`:
 *
 *   - the wait is kernel-side and blocking (no poll, no backoff);
 *   - the release is guaranteed on fd death — including SIGKILL/OOM-kill of
 *     the holder, the hole that Node `process.on('exit')`/signal handlers
 *     cannot cover (red-team finding #1 on #1873). No 1h stale-lock stall.
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
 *   - src/utils/run-cli.ts: runInteractive inherits stdio and applies no
 *     timeout — exactly what a long gate under a mutex needs (INV-12).
 */
import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  mkdirSync(dir, { recursive: true })
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
 * The exact argv gate-exec executes: blocking flock, exit-code passthrough.
 * `--` goes BEFORE the lock file (ends flock's own option parsing); flock
 * takes everything after the file verbatim as the command, so child flags
 * (e.g. `npm test --run`) are never eaten by flock.
 */
export function gateExecArgv(lockPath: string, cmdArgs: readonly string[]): string[] {
  return ['flock', '--', lockPath, ...cmdArgs]
}

export interface GateExecOptions {
  /** Command + args to run under the mutex (everything after `--`). */
  cmdArgs: readonly string[]
  /** Explicit mutex key — overrides per-repo derivation. */
  key?: string
  /** Target directory (defaults to cwd) — used for key derivation and as cwd. */
  dir?: string
}

/**
 * Run `cmdArgs` under the per-repo gate mutex. Blocks (kernel-side) until the
 * lock is free, inherits stdio, and returns the child's exit code verbatim.
 */
export function runGateExec(opts: GateExecOptions): number {
  const dir = opts.dir ?? process.cwd()
  assertFlockAvailable()
  const key = opts.key ?? deriveGateKey(dir)
  const lockPath = gateLockPath(key)
  process.stderr.write(`gate-exec: mutex ${lockPath} (blocking until free)\n`)
  const [flockBin, ...flockArgs] = gateExecArgv(lockPath, opts.cmdArgs)
  const { exitCode } = runInteractive(flockBin as string, flockArgs, { cwd: dir })
  return exitCode
}
