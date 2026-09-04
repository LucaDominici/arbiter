#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/lib/gate-mutex.mjs (#2427) — the per-repo gate mutex, reachable from
// `.mjs` land (the pre-push hook and `scripts/check-all.mjs`).
//
// The incident this exists for: a `git push` was killed while its pre-push L2
// ran. The orphaned gate kept going; the branch took another commit; a second
// push started a SECOND L2 in the same worktree. The two interfered (`docs:build`
// tripped over a half-deleted vitepress temp file, a subprocess-heavy unit test
// flaked under the doubled load) and the orphan finished green and stamped a
// marker for a tree it had never fully tested.
//
// CANON-16 — this is NOT a second mutex. `src/commands/gate-exec.ts` remains the
// owner of the contract; this file reproduces its KEY DERIVATION exactly (sha256
// of the resolved `git rev-parse --git-common-dir`, first 16 hex chars, under
// `$XDG_RUNTIME_DIR/arbiter`) and delegates acquisition to the same `flock(1)`
// primitive against the same lock file. The derivation moved here OUT of
// `scripts/capacity-probe.mjs`, which carried it as a documented duplicate; that
// script now imports it, so the copy count does not grow. Reuse-by-import is
// impossible in both directions: `gate-exec.ts` compiles into `dist/`, which
// ships WITHOUT `scripts/` (package.json "files"), and this file must run
// pre-build in a consumer checkout that has no arbiter `dist/` at all — the same
// constraint that already forced `scripts/lib/waiter-count.mjs` to exist and
// forced `gate-exec.ts` to shell OUT to it. `__tests__/scripts/gate-mutex.test.ts`
// pins the two derivations byte-for-byte so they cannot drift.
//
// Lock ordering (ADR-103 §4) is unchanged: the gate lock is a LEAF — it is never
// taken while `.arbiter/.lock` is held. Total order: gate-lock ≺ worktree-lock ≺
// wave-claim.
//
// AC-3 shape: the gate runs in the wrapper's OWN process group — no `setsid`, no
// `detached`, no background `&`. A terminal Ctrl-C therefore reaches the gate the
// same way it reaches `git push`. A pid-targeted signal is handled by forwarding
// it down the whole descendant tree, and a SIGKILL (which cannot be trapped) is
// covered by the independent orphan guard in `scripts/lib/run-helpers.mjs`, armed
// through `ARBITER_GATE_PARENT_PID`.
//
// INV-12 exception: direct child_process use is the documented carve-out for
// `.mjs` gate-utility libraries that run pre-build and cannot pull from `src/`
// (same carve-out as `scripts/lib/waiter-count.mjs` and `scripts/lib/loud-bypass.mjs`).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isMainModule, isProcessAlive } from './run-helpers.mjs'

export { isProcessAlive }

/** Set on the gate's environment once the mutex is held, so it is never re-taken. */
export const GATE_MUTEX_HELD_ENV = 'ARBITER_GATE_MUTEX_HELD'
/** The pid the gate exists to serve — the orphan guard watches it (AC-3). */
export const GATE_MUTEX_PARENT_ENV = 'ARBITER_GATE_PARENT_PID'
/** `flock`'s exit code when the mutex could not be taken (busy / wait expired). */
export const GATE_MUTEX_BUSY_EXIT = 111
/** How long a waiting gate blocks before failing closed. 30 min > one L2 run. */
export const GATE_MUTEX_DEFAULT_WAIT_SEC = 1800
/** Grace between the polite teardown signal and the SIGKILL sweep. */
const TEARDOWN_GRACE_MS = 5_000
/** Signal numbers for the shell's 128+n exit convention. */
const SIGNAL_NUMBERS = Object.freeze({ SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 })

/**
 * The per-repo lock path — byte-identical to `gateLockPath(deriveGateKey(dir))`
 * in `src/commands/gate-exec.ts`. Every worktree of a repo shares the main
 * repo's common dir, so they converge on ONE lock. The file lives OUTSIDE the
 * repo: a per-worktree lock would be a null mutex, an in-repo one would dirty
 * every tree it guards.
 */
export function gateLockPathFor(dir = process.cwd(), env = process.env) {
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: dir,
    encoding: 'utf-8',
  }).trim()
  // --git-common-dir may be relative (e.g. ".git" from the repo root).
  const absolute = resolve(dir, commonDir)
  const key = createHash('sha256').update(absolute).digest('hex').slice(0, 16)
  const base = env.XDG_RUNTIME_DIR || tmpdir()
  const lockDir = join(base, 'arbiter')
  mkdirSync(lockDir, { recursive: true })
  return join(lockDir, `${key}-gate.lock`)
}

/** True when `flock(1)` can actually be run here. */
export function flockAvailable(env = process.env) {
  const probe = spawnSync('flock', ['--version'], { env, stdio: 'ignore', timeout: 10_000 })
  return probe.error === undefined && probe.status === 0
}

/**
 * Direct children of `pid` via Linux procfs. Returns [] wherever
 * `/proc/<pid>/task/<tid>/children` is unavailable — the teardown then degrades
 * to signalling the direct child only, and the orphan guard remains the backstop.
 */
function childPids(pid) {
  const out = []
  try {
    const taskDir = `/proc/${pid}/task`
    for (const tid of readdirSync(taskDir)) {
      const raw = readFileSync(join(taskDir, tid, 'children'), 'utf-8').trim()
      if (raw === '') continue
      for (const part of raw.split(/\s+/)) {
        const child = Number(part)
        if (Number.isInteger(child) && child > 0) out.push(child)
      }
    }
    // FAIL-OPEN-INTENT: an unreadable procfs entry means "no discoverable children",
    // which only narrows the teardown — the orphan guard still covers the residual.
  } catch {
    return out
  }
  return out
}

/**
 * Signal `pid` and every descendant, deepest-first — the tree is read BEFORE the
 * parents are signalled, so nothing is lost to a vanishing intermediate process.
 */
export function killTree(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return
  for (const child of childPids(pid)) killTree(child, signal)
  try {
    process.kill(pid, signal)
    // FAIL-OPEN-INTENT: ESRCH means the process is already gone, which is the
    // outcome this function exists to produce.
  } catch {
    void 0
  }
}

/**
 * `flock` argv for the requested mode. `-o` (--close) drops the lock fd before
 * the gate is exec'd so no gate DESCENDANT retains the mutex; `flock` itself
 * forks and keeps the fd, so the lock is held for the gate's whole life.
 * `--` ends flock's option parsing so the gate's own flags are never eaten.
 */
export function gateMutexArgv(lockPath, cmdArgs, { mode = 'wait', waitSec } = {}) {
  const acquire = mode === 'fail' ? ['-n'] : ['-w', String(waitSec ?? GATE_MUTEX_DEFAULT_WAIT_SEC)]
  return ['flock', ...acquire, '-E', String(GATE_MUTEX_BUSY_EXIT), '-o', '--', lockPath, ...cmdArgs]
}

/** Non-destructive probe: is somebody else holding the mutex right now? */
function mutexIsBusy(lockPath, env) {
  const probe = spawnSync(
    'flock',
    ['-n', '-E', String(GATE_MUTEX_BUSY_EXIT), '--', lockPath, 'true'],
    {
      env,
      stdio: 'ignore',
      timeout: 10_000,
    },
  )
  return probe.status === GATE_MUTEX_BUSY_EXIT
}

/** Resolve the wait budget, ignoring a non-positive or unparseable override. */
function waitBudgetSec(env) {
  const raw = Number(env.ARBITER_GATE_MUTEX_WAIT_SEC)
  return Number.isFinite(raw) && raw > 0 ? raw : GATE_MUTEX_DEFAULT_WAIT_SEC
}

/** Run `cmdArgs` as a plain foreground child, forwarding signals and the exit code. */
function runForeground(argv, { env, cwd }) {
  return new Promise((resolvePromise) => {
    // detached is deliberately ABSENT (AC-3): the gate stays in this process
    // group, so a terminal signal reaches it exactly as it reaches `git push`.
    const child = spawn(argv[0], argv.slice(1), { env, cwd, stdio: 'inherit' })
    let sweep = null

    const teardown = (signal) => {
      killTree(child.pid, signal)
      if (sweep === null) {
        sweep = setTimeout(() => killTree(child.pid, 'SIGKILL'), TEARDOWN_GRACE_MS)
        sweep.unref()
      }
    }
    const onSignal = (signal) => teardown(signal)
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
    for (const signal of signals) process.on(signal, onSignal)
    // A wrapper that dies for any other reason must not leave the gate behind.
    const onExit = () => killTree(child.pid, 'SIGKILL')
    process.on('exit', onExit)

    child.on('error', (err) => {
      process.stderr.write(`gate-mutex: could not start the gate: ${err.message}\n`)
      resolvePromise(127)
    })
    child.on('close', (code, signal) => {
      for (const s of signals) process.off(s, onSignal)
      process.off('exit', onExit)
      if (sweep !== null) clearTimeout(sweep)
      if (signal) resolvePromise(128 + (SIGNAL_NUMBERS[signal] ?? 15))
      else resolvePromise(code ?? 1)
    })
  })
}

/**
 * Run the gate under the per-repo mutex.
 *
 * Modes (`ARBITER_GATE_MUTEX_MODE`): `wait` (default — block, having ANNOUNCED
 * the wait on stderr the moment it starts, then fail closed when the budget
 * expires), `fail` (never queue: refuse immediately if another gate holds the
 * mutex), `off` (run unserialised — also the automatic fallback where `flock(1)`
 * does not exist, e.g. the macOS base system, announced loudly).
 *
 * Returns the gate's own exit code verbatim, or GATE_MUTEX_BUSY_EXIT when the
 * mutex could not be taken. That code is deliberately rare but not reserved: a
 * gate that itself exits 111 is indistinguishable, which is why the refusal is
 * always accompanied by its own stderr line.
 */
export async function runUnderGateLock({
  dir = process.cwd(),
  cmdArgs = [],
  env = process.env,
} = {}) {
  if (cmdArgs.length === 0) {
    process.stderr.write('gate-mutex: nothing to run — expected a command after `--`\n')
    return 2
  }
  const lockPath = gateLockPathFor(dir, env)
  const childEnv = {
    ...env,
    [GATE_MUTEX_HELD_ENV]: lockPath,
    // The process the gate exists to SERVE — this wrapper's own parent (the git
    // hook shell, the terminal, the agent), not the wrapper. An outer layer that
    // already declared one wins, so the watched pid is always the outermost
    // launcher rather than an intermediate relay.
    [GATE_MUTEX_PARENT_ENV]: env[GATE_MUTEX_PARENT_ENV] || String(process.ppid),
  }

  // Already held by an ancestor (`arbiter gate-exec`, or an outer gate-mutex):
  // re-acquiring the same flock from a second process would DEADLOCK.
  if (env[GATE_MUTEX_HELD_ENV] === lockPath) {
    return runForeground(cmdArgs, { env: childEnv })
  }

  const mode = env.ARBITER_GATE_MUTEX_MODE ?? 'wait'
  if (mode === 'off' || !flockAvailable(env)) {
    if (mode !== 'off') {
      process.stderr.write(
        'gate-mutex: flock(1) is not available on this platform — the gate is running ' +
          'UNSERIALISED. Two gates in this repo can now interfere; run them one at a time, ' +
          'or use `arbiter gate-exec` on a platform that has flock.\n',
      )
    }
    return runForeground(cmdArgs, { env: childEnv })
  }

  const waitSec = waitBudgetSec(env)
  if (mode !== 'fail' && mutexIsBusy(lockPath, env)) {
    // Announced BEFORE the block starts: a push that stalls silently for twenty
    // minutes is how operators learn to reach for --no-verify.
    process.stderr.write(
      `gate-mutex: another gate is already running in this repo — waiting up to ${waitSec}s ` +
        `for ${lockPath}. Set ARBITER_GATE_MUTEX_MODE=fail to refuse instead of queueing.\n`,
    )
  }

  const exitCode = await runForeground(gateMutexArgv(lockPath, cmdArgs, { mode, waitSec }), {
    env: childEnv,
  })
  if (exitCode === GATE_MUTEX_BUSY_EXIT) {
    process.stderr.write(
      `gate-mutex: refusing to run — another gate holds ${lockPath}` +
        `${mode === 'fail' ? '' : ` after waiting ${waitSec}s`}. The gate did NOT run.\n`,
    )
  }
  return exitCode
}

// ── CLI: `node scripts/lib/gate-mutex.mjs path|run [--dir d] [-- cmd...]` ─────
function flagValue(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1 || index + 1 >= argv.length) return fallback
  return argv[index + 1]
}

async function main(argv) {
  const subcommand = argv[0]
  const dir = flagValue(argv, 'dir', process.cwd())
  if (subcommand === 'path') {
    process.stdout.write(`${gateLockPathFor(dir)}\n`)
    return 0
  }
  if (subcommand === 'run') {
    const sep = argv.indexOf('--')
    const cmdArgs = sep === -1 ? [] : argv.slice(sep + 1)
    return runUnderGateLock({ dir, cmdArgs })
  }
  process.stderr.write('usage: gate-mutex.mjs path [--dir d] | run [--dir d] -- <cmd...>\n')
  return 2
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      process.stderr.write(`gate-mutex: unexpected error: ${err?.stack ?? err}\n`)
      process.exitCode = 1
    },
  )
}
