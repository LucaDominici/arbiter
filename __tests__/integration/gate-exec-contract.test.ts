// SPDX-License-Identifier: Apache-2.0
// Contract tests for the gate-exec mutex (#1873 T3, AC 1-2):
//   1. Two concurrent gate-exec critical sections NEVER overlap.
//   2. SIGKILL of the holder (OOM-kill model: whole process tree) releases the
//      lock IMMEDIATELY — the next waiter enters with no stale-age stall.
// Baseline tests exercise the direct-flock compatibility primitive; the #2346
// regressions spawn the real source CLI and verify its supervised topology.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { gateExecArgv, gateLockPath } from '../../src/commands/gate-exec.js'

const CLI_PATH = resolve(new URL('../../src/cli.ts', import.meta.url).pathname)
const TSX_ESM_LOADER = createRequire(import.meta.url).resolve('tsx/esm')

function spawnGate(
  lockPath: string,
  shellScript: string,
  opts: { detached?: boolean } = {},
): ReturnType<typeof spawn> {
  const [bin, ...args] = gateExecArgv(lockPath, ['sh', '-c', shellScript])
  return spawn(bin as string, args, {
    stdio: 'ignore',
    detached: opts.detached ?? false,
  })
}

function waitExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode)
  }
  return new Promise((resolve) => child.on('close', (code) => resolve(code)))
}

function spawnGateCli(dir: string, key: string, shellScript: string): ReturnType<typeof spawn> {
  return spawn(
    process.execPath,
    [
      '--import',
      TSX_ESM_LOADER,
      CLI_PATH,
      'gate-exec',
      '--key',
      key,
      '--dir',
      dir,
      '--',
      'sh',
      '-c',
      shellScript,
    ],
    {
      cwd: dir,
      env: { ...process.env, XDG_RUNTIME_DIR: dir, ARBITER_NO_EVIDENCE: '1' },
      stdio: 'ignore',
    },
  )
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
    if (!isProcessAlive(pid)) return true
    await sleep(25)
  }
  return !isProcessAlive(pid)
}

/** Linux exposes direct children without a process-name race or a `pgrep` dependency. */
async function waitForDirectChild(pid: number, timeoutMs: number): Promise<number | undefined> {
  const childrenPath = `/proc/${pid}/task/${pid}/children`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const child = Number(readFileSync(childrenPath, 'utf-8').trim().split(/\s+/)[0])
      if (Number.isInteger(child) && child > 0) return child
    } catch {
      // Parent may still be starting or may already have exited.
    }
    await sleep(25)
  }
  return undefined
}

function isProcessAlive(pid: number): boolean {
  try {
    const state = readFileSync(`/proc/${pid}/stat`, 'utf-8').match(/^\d+ \(.+\) (\S)/)?.[1]
    if (state === 'Z') return false
  } catch {
    // Fall through to the portable liveness probe when /proc is unavailable.
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
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

  it('keeps the mutex held when the lock supervisor (the pre-fix flock holder) is SIGKILLed', async () => {
    const key = 'kill-flock-holder'
    const cliLockPath = gateLockPath(key, { XDG_RUNTIME_DIR: dir })
    const commandPidPath = join(dir, 'gated-command.pid')
    const holder = spawnGateCli(
      dir,
      key,
      `echo $$ > "${commandPidPath}"; while :; do sleep 1; done`,
    )
    let lockSupervisorPid: number | undefined
    let commandPid: number | undefined

    try {
      expect(await waitUntilExists(commandPidPath, 10_000)).toBe(true)
      expect(await waitUntilHeld(cliLockPath, 10_000)).toBe(true)
      lockSupervisorPid = await waitForDirectChild(holder.pid as number, 10_000)
      commandPid = Number(readFileSync(commandPidPath, 'utf-8').trim())
      expect(lockSupervisorPid).toBeDefined()
      expect(isProcessAlive(commandPid)).toBe(true)

      // Pin the exact #2346 window: before the fix this direct child was flock,
      // and stopping Node prevented it from reacting before the second acquire.
      process.kill(holder.pid as number, 'SIGSTOP')
      process.kill(lockSupervisorPid as number, 'SIGKILL')
      expect(await waitUntilExited(lockSupervisorPid as number, 5_000)).toBe(true)
      expect(isProcessAlive(commandPid)).toBe(true)

      const probe = spawnSync('flock', ['-n', '--', cliLockPath, 'true'])
      expect(probe.status).not.toBe(0)

      process.kill(holder.pid as number, 'SIGCONT')
      expect(await waitExit(holder)).not.toBe(0)
      expect(isProcessAlive(commandPid)).toBe(false)
      expect(spawnSync('flock', ['-n', '--', cliLockPath, 'true']).status).toBe(0)
    } finally {
      for (const pid of [holder.pid, lockSupervisorPid, commandPid]) {
        if (pid === undefined || !isProcessAlive(pid)) continue
        try {
          process.kill(pid, 'SIGCONT')
          process.kill(pid, 'SIGKILL')
        } catch {
          // The process may have exited between the liveness probe and cleanup.
        }
      }
    }
  }, 30_000)

  it('tears down a setsid-escaped gate before releasing the mutex (RW-1)', async () => {
    const key = 'setsid-escape'
    const cliLockPath = gateLockPath(key, { XDG_RUNTIME_DIR: dir })
    const escapedPidPath = join(dir, 'escaped-command.pid')
    const holder = spawnGateCli(
      dir,
      key,
      `exec setsid sh -c 'echo $$ > "${escapedPidPath}"; while :; do sleep 1; done'`,
    )
    let supervisorPid: number | undefined
    let escapedPid: number | undefined

    try {
      expect(await waitUntilExists(escapedPidPath, 10_000)).toBe(true)
      expect(await waitUntilHeld(cliLockPath, 10_000)).toBe(true)
      supervisorPid = await waitForDirectChild(holder.pid as number, 10_000)
      escapedPid = Number(readFileSync(escapedPidPath, 'utf-8').trim())
      expect(supervisorPid).toBeDefined()
      expect(isProcessAlive(escapedPid)).toBe(true)

      process.kill(supervisorPid as number, 'SIGKILL')

      expect(await waitExit(holder)).not.toBe(0)
      expect(await waitUntilExited(escapedPid, 5_000)).toBe(true)
      expect(spawnSync('flock', ['-n', '--', cliLockPath, 'true']).status).toBe(0)
    } finally {
      for (const pid of [holder.pid, supervisorPid, escapedPid]) {
        if (pid === undefined || !isProcessAlive(pid)) continue
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // The process may have exited between the liveness probe and cleanup.
        }
      }
    }
  }, 30_000)

  it('Ctrl-C tears down the gated command and releases the mutex (RW-2)', async () => {
    const key = 'operator-sigint'
    const cliLockPath = gateLockPath(key, { XDG_RUNTIME_DIR: dir })
    const commandPidPath = join(dir, 'interrupted-command.pid')
    const holder = spawnGateCli(
      dir,
      key,
      `echo $$ > "${commandPidPath}"; while :; do sleep 1; done`,
    )
    let supervisorPid: number | undefined
    let commandPid: number | undefined

    try {
      expect(await waitUntilExists(commandPidPath, 10_000)).toBe(true)
      expect(await waitUntilHeld(cliLockPath, 10_000)).toBe(true)
      supervisorPid = await waitForDirectChild(holder.pid as number, 10_000)
      commandPid = Number(readFileSync(commandPidPath, 'utf-8').trim())
      expect(supervisorPid).toBeDefined()
      expect(isProcessAlive(commandPid)).toBe(true)

      process.kill(holder.pid as number, 'SIGINT')

      expect(await waitExit(holder)).toBe(130)
      expect(await waitUntilExited(commandPid, 5_000)).toBe(true)
      expect(spawnSync('flock', ['-n', '--', cliLockPath, 'true']).status).toBe(0)
    } finally {
      for (const pid of [holder.pid, supervisorPid, commandPid]) {
        if (pid === undefined || !isProcessAlive(pid)) continue
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // The process may have exited between the liveness probe and cleanup.
        }
      }
    }
  }, 30_000)

  it('releases the mutex after the gated command exits normally', async () => {
    const key = 'normal-exit-control'
    const cliLockPath = gateLockPath(key, { XDG_RUNTIME_DIR: dir })
    const holder = spawnGateCli(dir, key, 'true')

    expect(await waitExit(holder)).toBe(0)
    expect(spawnSync('flock', ['-n', '--', cliLockPath, 'true']).status).toBe(0)
  }, 15_000)

  it('does not leave the mutex held when the gate backgrounds a child', async () => {
    const key = 'background-child'
    const cliLockPath = gateLockPath(key, { XDG_RUNTIME_DIR: dir })
    const childPidPath = join(dir, 'background-child.pid')
    let backgroundPid: number | undefined
    try {
      // The backgrounded sleep outlives its shell. The supervised command must
      // close fd 3 before exec so this descendant cannot retain the mutex.
      const first = spawnGateCli(dir, key, `sleep 30 & echo $! > "${childPidPath}"; exit 0`)
      expect(await waitExit(first)).toBe(0)
      expect(await waitUntilExists(childPidPath, 5_000)).toBe(true)
      backgroundPid = Number(readFileSync(childPidPath, 'utf-8').trim())

      // Bound the probe so an inherited descriptor fails loudly instead of
      // holding the suite behind the backgrounded process.
      const start = Date.now()
      const code = spawnSync('flock', ['-w', '1', '--', cliLockPath, 'true']).status
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
