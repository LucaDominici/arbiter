// SPDX-License-Identifier: Apache-2.0
// #2282: ONE lock-holder fixture for every wall-clock liveness test that observes a
// real `flock` holder through a real OS probe.
//
// Two tests used to hand-roll this and both were flaky under load
// (__tests__/scripts/lib/waiter-count.test.ts, __tests__/commands/gate-exec.test.ts
// gateQueueAdvisory). They shared one defect: the holder lived for exactly as long as
// the observation budget (`sleep 2` vs `while (Date.now() - start < 2000)`), so on a
// loaded runner the observation calls completed too late to catch a process that had
// already run its course — every poll inside the window reported 0. The tight poll
// loop, which forked `fuser` (or a whole `node`) with no sleep, was itself part of the
// load that caused it.
//
// The fix is a margin: the holder must outlive the observation window by enough that a
// late-scheduled probe still lands inside its lifetime. MIN_MARGIN_MS makes that
// requirement checkable instead of implicit — see lock-holder.test.ts.
import { spawn, type ChildProcess } from 'node:child_process'

/** How long a poll loop is allowed to keep looking for the holder. */
export const OBSERVE_BUDGET_MS = 2000

/**
 * Minimum slack the holder's lifetime must have OVER the observation budget. Sized so a
 * probe whose fork/exec is delayed by seconds on a saturated runner still observes a
 * live holder — the quiet-state observations these tests need take 48-59 ms, so the
 * entire failure mode is scheduling delay, not work.
 */
export const MIN_MARGIN_MS = 5000

/** Lifetime of the spawned holder, in seconds (`sleep <n>` under `flock`). */
export const HOLDER_SECONDS = 2

/**
 * Background `flock` holder over `lockPath`, in its OWN process group so teardown can
 * reap the `sleep` child too — `holder.kill()` alone signals `flock` and leaves `sleep`
 * orphaned for its full lifetime.
 */
export function spawnLockHolder(lockPath: string, flockOpts: string[] = ['-o']): ChildProcess {
  return spawn('flock', [...flockOpts, '--', lockPath, 'sleep', String(HOLDER_SECONDS)], {
    stdio: 'ignore',
    detached: true,
  })
}

/** Kill the holder's whole process group. Safe to call twice; ESRCH means already gone. */
export function killLockHolder(holder: ChildProcess): void {
  if (holder.pid === undefined) return
  try {
    process.kill(-holder.pid, 'SIGKILL')
  } catch {
    // Already reaped, or the group vanished between the check and the signal.
  }
}

/** True while the process still exists. Signal 0 reads the process table; it does NOT
 *  consult Node's event state, so it stays correct regardless of event-loop pressure
 *  (`holder.exitCode` is `null` for BOTH a live child and a signal-killed one). */
export function isAlive(holder: ChildProcess): boolean {
  if (holder.pid === undefined) return false
  try {
    process.kill(holder.pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Poll `probe` until `ok` accepts its value or `budgetMs` elapses, sleeping 10 ms between
 * attempts so the loop stops being the load it is trying to measure. Async on purpose: a
 * synchronous sleep (`Atomics.wait`, `execSync('sleep')`) blocks the event loop or forks
 * per iteration — the first starves child-lifecycle events, the second re-adds the load.
 */
export async function pollUntil<T>(
  probe: () => T,
  ok: (value: T) => boolean,
  budgetMs: number = OBSERVE_BUDGET_MS,
): Promise<T> {
  const start = Date.now()
  let value = probe()
  while (!ok(value) && Date.now() - start < budgetMs) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    value = probe()
  }
  return value
}
