// SPDX-License-Identifier: Apache-2.0
// Contract tests for the gate-exec mutex (#1873 T3, AC 1-2):
//   1. Two concurrent gate-exec critical sections NEVER overlap.
//   2. SIGKILL of the holder (OOM-kill model: whole process tree) releases the
//      lock IMMEDIATELY — the next waiter enters with no stale-age stall.
// The tests spawn the EXACT argv gate-exec composes (gateExecArgv), so they
// exercise the kernel semantics of the artifact the command runs — not a
// reimplementation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateExecArgv } from '../../src/commands/gate-exec.js'

function spawnGate(
  lockPath: string,
  shellScript: string,
  opts: { detached?: boolean; timeoutSeconds?: number } = {},
): ReturnType<typeof spawn> {
  const [bin, ...args] = gateExecArgv(lockPath, ['sh', '-c', shellScript])
  const command = opts.timeoutSeconds === undefined ? (bin as string) : 'timeout'
  const commandArgs =
    opts.timeoutSeconds === undefined ? args : [`${opts.timeoutSeconds}s`, bin as string, ...args]
  return spawn(command, commandArgs, {
    stdio: 'ignore',
    detached: opts.detached ?? false,
  })
}

function waitExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => child.on('close', (code) => resolve(code)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll until the lock is HELD (flock -n fails) or timeout. */
async function waitUntilHeld(lockPath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      execFileSync('flock', ['-n', '--', lockPath, 'true'])
      // acquired instantly → not held yet
    } catch {
      return true // -n failed → someone holds it
    }
    await sleep(50)
  }
  return false
}

/**
 * Poll until `path` exists or timeout. `flock(1)` acquires the lock and THEN
 * fork+execs the guarded command (`sh -c '...'`) — so `waitUntilHeld` going
 * true only proves the OUTER flock has the lock, not that the INNER shell
 * has started running yet. Under CPU contention that fork+exec gap widens
 * enough to lose a bare `existsSync` race (confirmed empirically: flaky under
 * synthetic load though 3/3 clean on an idle box — the same load-sensitive-
 * assumption class as #1891's acquisition-wait budget, but a second, distinct
 * window in this same test). Poll instead of assuming instant.
 */
async function waitUntilExists(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await sleep(50)
  }
  return existsSync(path)
}

/** Poll until a process is gone, so a failed regression never leaks its child. */
async function waitUntilExited(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await sleep(25)
  }
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

describe('gate-exec mutex contract (#1873 T3)', () => {
  let dir: string
  let lockPath: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gate-contract-'))
    lockPath = join(dir, 'gate.lock')
    logPath = join(dir, 'sections.log')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('two concurrent gate-exec runs never overlap their critical sections', async () => {
    // Each section logs start/end with a nanosecond timestamp, holding the
    // lock for ~300ms. Started together: without the mutex they WOULD overlap.
    const section = (id: string): string =>
      `echo "start ${id} $(date +%s%N)" >> "${logPath}"; sleep 0.3; echo "end ${id} $(date +%s%N)" >> "${logPath}"`

    const a = spawnGate(lockPath, section('A'))
    const b = spawnGate(lockPath, section('B'))
    const [codeA, codeB] = await Promise.all([waitExit(a), waitExit(b)])
    expect(codeA).toBe(0)
    expect(codeB).toBe(0)

    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(4)
    const events = lines.map((l) => {
      const [kind, id, ts] = l.split(' ')
      return { kind, id, ts: BigInt(ts as string) }
    })
    events.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0))
    // Serialized: start,end,start,end — never start,start.
    expect(events.map((e) => e.kind)).toEqual(['start', 'end', 'start', 'end'])
    // And the two sections belong to different runs.
    expect(events[0]!.id).toBe(events[1]!.id)
    expect(events[2]!.id).toBe(events[3]!.id)
    expect(events[0]!.id).not.toBe(events[2]!.id)
  }, 15_000)

  it('SIGKILL of the holder releases the lock immediately (no stale-age stall)', async () => {
    // Holder takes the lock "forever" (30s). detached → own process group, so
    // we can SIGKILL the whole tree — the OOM-kill model for a gate run.
    const holder = spawnGate(lockPath, `touch "${join(dir, 'held')}"; sleep 30`, {
      detached: true,
    })
    expect(await waitUntilHeld(lockPath, 15_000)).toBe(true)
    expect(await waitUntilExists(join(dir, 'held'), 5_000)).toBe(true)

    process.kill(-(holder.pid as number), 'SIGKILL')

    // The kernel releases the flock as the fds die: a waiter must get through
    // in far less than any stale-age window (assert < 5s; typical ≪ 1s).
    const start = Date.now()
    const waiter = spawnGate(lockPath, 'true')
    const code = await waitExit(waiter)
    const elapsed = Date.now() - start
    expect(code).toBe(0)
    expect(elapsed).toBeLessThan(5_000)
  }, 30_000)

  it('does not leave the mutex held when the gate backgrounds a child', async () => {
    const childPidPath = join(dir, 'background-child.pid')
    let backgroundPid: number | undefined
    try {
      // The backgrounded sleep outlives its shell. Without flock --close (-o),
      // it inherits flock's lock fd and makes the next gate wait behind it.
      const first = spawnGate(lockPath, `sleep 30 & echo $! > "${childPidPath}"; exit 0`)
      expect(await waitExit(first)).toBe(0)
      expect(await waitUntilExists(childPidPath, 5_000)).toBe(true)
      backgroundPid = Number(readFileSync(childPidPath, 'utf-8').trim())

      // Run the exact argv from gateExecArgv under a bounded outer timeout so
      // the red regression fails loudly instead of holding the suite hostage.
      const start = Date.now()
      const second = spawnGate(lockPath, 'true', { timeoutSeconds: 1 })
      const code = await waitExit(second)
      const elapsed = Date.now() - start
      expect(code).toBe(0)
      expect(elapsed).toBeLessThan(500)
    } finally {
      if (backgroundPid === undefined && existsSync(childPidPath)) {
        backgroundPid = Number(readFileSync(childPidPath, 'utf-8').trim())
      }
      if (backgroundPid !== undefined && Number.isInteger(backgroundPid) && backgroundPid > 0) {
        try {
          process.kill(backgroundPid, 'SIGKILL')
        } catch {
          // The process may have already exited; cleanup is best effort.
        }
        expect(await waitUntilExited(backgroundPid, 5_000)).toBe(true)
      }
    }
  }, 15_000)
})
