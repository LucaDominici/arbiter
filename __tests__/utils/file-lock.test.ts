// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import {
  acquireLock,
  inspectLock,
  forceReleaseLock,
  type LockHandle,
  type LockInfo,
} from '../../src/utils/file-lock.js'

function realBootId(): string {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim()
  } catch {
    return 'unknown'
  }
}

describe('file-lock (#614 #618)', () => {
  let dir: string
  let lockPath: string

  beforeEach(() => {
    dir = createTestProject()
    lockPath = join(dir, '.arbiter', '.lock')
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  // ── Acquire / release ─────────────────────────────────────────────────────

  it('creates lock file on acquire', async () => {
    const handle = await acquireLock(lockPath)
    expect(existsSync(lockPath)).toBe(true)
    await handle.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('lock file contains required JSON fields', async () => {
    const handle = await acquireLock(lockPath)
    const info = JSON.parse(readFileSync(lockPath, 'utf-8')) as Record<string, unknown>
    expect(typeof info.pid).toBe('number')
    expect(typeof info.hostname).toBe('string')
    expect(typeof info.bootId).toBe('string')
    expect(typeof info.startedAt).toBe('string')
    expect(typeof info.cmd).toBe('string')
    expect(typeof info.nonce).toBe('string')
    await handle.release()
  })

  // #1617: acquireLock is REENTRANT within a single process. A same-path
  // re-acquire by the holding process is a ref-counted no-op — it neither
  // rejects nor rewrites the on-disk lock — and the lockfile survives until the
  // LAST holder releases. (Cross-process exclusion is unchanged — see the EPERM
  // and 20-concurrent contention tests below.)
  it('re-acquire in the same process is reentrant (ref-counted)', async () => {
    const h1 = await acquireLock(lockPath)
    const first = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo

    const h2 = await acquireLock(lockPath)
    const second = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
    // Reentrant acquire did not rewrite the lock (same nonce).
    expect(second.nonce).toBe(first.nonce)

    // Releasing one holder leaves the lock in place (ref-count still > 0).
    await h1.release()
    expect(existsSync(lockPath)).toBe(true)

    // The final release unlinks it; a double-release is a harmless no-op.
    await h2.release()
    expect(existsSync(lockPath)).toBe(false)
    await h2.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('allows re-acquire after release', async () => {
    const h1 = await acquireLock(lockPath)
    await h1.release()
    const h2 = await acquireLock(lockPath)
    await h2.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  // ── Contention — exactly one of N concurrent acquires wins ────────────────

  it('exactly 1 of 20 concurrent acquires succeeds', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => acquireLock(lockPath)),
    )
    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<LockHandle>[]
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(19)
    await fulfilled[0]!.value.release()
  })

  // ── Ownership-checked deletion — nonce guard (#1636) ──────────────────────

  // After a legitimate stale-takeover the lockfile belongs to ANOTHER holder
  // (a fresh nonce). Our release()/exit/signal cleanup must not unlink it, or a
  // third process could acquire concurrently with the new owner — two holders.
  it('release() does NOT unlink a lock taken over by another holder (nonce mismatch)', async () => {
    const handle = await acquireLock(lockPath)
    const mine = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo

    // Simulate a stale-takeover: another process rewrote the lockfile with a
    // different nonce while we still hold our handle.
    const takenOver: LockInfo = { ...mine, pid: mine.pid + 1, nonce: 'taken-over-nonce' }
    writeFileSync(lockPath, JSON.stringify(takenOver))

    await handle.release()

    // The foreign lock survives our cleanup, intact.
    expect(existsSync(lockPath)).toBe(true)
    const after = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
    expect(after.nonce).toBe('taken-over-nonce')
  })

  // The matching positive case: when the on-disk nonce still matches ours, the
  // final release unlinks normally.
  it('release() unlinks the lock when the on-disk nonce still matches (ours)', async () => {
    const handle = await acquireLock(lockPath)
    expect(existsSync(lockPath)).toBe(true)
    await handle.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  // ── Stale detection — dead PID ────────────────────────────────────────────

  it('auto-takeovers stale lock whose PID is dead (ESRCH)', async () => {
    const deadPid = 9999999
    const stale: LockInfo = {
      pid: deadPid,
      hostname: os.hostname(),
      bootId: 'same-boot-id',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      cmd: 'arbiter init',
      nonce: 'old-nonce',
    }
    writeFileSync(lockPath, JSON.stringify(stale))

    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (pid === deadPid && sig === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      return true
    })

    const handle = await acquireLock(lockPath)
    const info = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
    expect(info.pid).toBe(process.pid)
    await handle.release()
  })

  it('does NOT takeover when PID is alive (EPERM — different user)', async () => {
    const alivePid = 1234
    const held: LockInfo = {
      pid: alivePid,
      hostname: os.hostname(),
      bootId: realBootId(),
      startedAt: new Date().toISOString(),
      cmd: 'arbiter init',
      nonce: 'held-nonce',
    }
    writeFileSync(lockPath, JSON.stringify(held))

    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (pid === alivePid && sig === 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      return true
    })

    await expect(acquireLock(lockPath)).rejects.toThrow()
  })

  // ── Staleness is liveness-first (#1873 T2) ────────────────────────────────
  // Age alone must NEVER steal a lock from a LIVE same-boot process: a gate
  // legitimately running >1h would otherwise be taken over → two concurrent
  // holders (the hop-2 double-gate finding on issue #1873).

  it('does NOT steal a live same-boot lock older than 1h (liveness-first)', async () => {
    const alivePid = 4242
    const longRunning: LockInfo = {
      pid: alivePid,
      hostname: os.hostname(),
      bootId: realBootId(),
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // age 2h
      cmd: 'arbiter gate-exec -- npm test',
      nonce: 'live-holder',
    }
    writeFileSync(lockPath, JSON.stringify(longRunning))

    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (pid === alivePid && sig === 0) return true // pid is ALIVE
      return true
    })

    await expect(acquireLock(lockPath)).rejects.toThrow(/already running|PID/i)
    // The live holder's lock is untouched.
    const after = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
    expect(after.nonce).toBe('live-holder')
  })

  it('treats a dead same-boot pid as stale regardless of age', async () => {
    const deadPid = 9999998
    const fresh: LockInfo = {
      pid: deadPid,
      hostname: os.hostname(),
      bootId: realBootId(),
      startedAt: new Date(Date.now() - 5_000).toISOString(), // age 5s only
      cmd: 'arbiter update',
      nonce: 'dead-holder',
    }
    writeFileSync(lockPath, JSON.stringify(fresh))

    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (pid === deadPid && sig === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      return true
    })

    const handle = await acquireLock(lockPath)
    const info = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
    expect(info.pid).toBe(process.pid)
    await handle.release()
  })

  it('treats a different-boot lock as stale (pid namespace reset)', async () => {
    const stale: LockInfo = {
      pid: process.pid, // "alive" pid — irrelevant: boot differs
      hostname: os.hostname(),
      bootId: 'a-previous-boot-id',
      startedAt: new Date().toISOString(),
      cmd: 'arbiter update',
      nonce: 'pre-reboot',
    }
    writeFileSync(lockPath, JSON.stringify(stale))

    const handle = await acquireLock(lockPath)
    const info = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
    expect(info.pid).toBe(process.pid)
    await handle.release()
  })

  it('unknown-user pid (EPERM): age backstop applies — stale after threshold', async () => {
    const foreignPid = 1234
    const old: LockInfo = {
      pid: foreignPid,
      hostname: os.hostname(),
      bootId: realBootId(),
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // age 2h > 1h default
      cmd: 'arbiter update',
      nonce: 'foreign-user',
    }
    writeFileSync(lockPath, JSON.stringify(old))

    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (pid === foreignPid && sig === 0)
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      return true
    })

    const handle = await acquireLock(lockPath)
    const info = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
    expect(info.pid).toBe(process.pid)
    await handle.release()
  })

  // ── Cross-host lock — never auto-takeover ────────────────────────────────

  it('refuses auto-takeover when hostname differs', async () => {
    const foreign: LockInfo = {
      pid: 5678,
      hostname: 'different-host',
      bootId: 'some-boot-id',
      startedAt: new Date(Date.now() - 100).toISOString(),
      cmd: 'arbiter init',
      nonce: 'x',
    }
    writeFileSync(lockPath, JSON.stringify(foreign))

    await expect(acquireLock(lockPath)).rejects.toThrow(/--recover-lock|different host/i)
  })

  // ── Symlink rejection ─────────────────────────────────────────────────────

  it('rejects symlink at lockPath', async () => {
    const { symlinkSync } = await import('node:fs')
    const target = join(dir, 'harmless.txt')
    writeFileSync(target, '')
    symlinkSync(target, lockPath)
    await expect(acquireLock(lockPath)).rejects.toThrow(/symlink/i)
  })

  // ── inspectLock ───────────────────────────────────────────────────────────

  it('inspectLock returns null when no lock file', async () => {
    expect(await inspectLock(lockPath)).toBeNull()
  })

  it('inspectLock returns parsed LockInfo when lock exists', async () => {
    const handle = await acquireLock(lockPath)
    const info = await inspectLock(lockPath)
    expect(info).not.toBeNull()
    expect(info!.pid).toBe(process.pid)
    await handle.release()
  })

  // ── forceReleaseLock (--recover-lock) ────────────────────────────────────

  it('forceReleaseLock deletes lock when expected PID matches', async () => {
    const handle = await acquireLock(lockPath)
    const { pid } = handle
    await handle.release()
    // Re-create manually to simulate a stuck lock
    const stuck: LockInfo = {
      pid,
      hostname: os.hostname(),
      bootId: 'b',
      startedAt: new Date().toISOString(),
      cmd: 'test',
      nonce: 'n',
    }
    writeFileSync(lockPath, JSON.stringify(stuck))
    await forceReleaseLock(lockPath, pid, dir)
    expect(existsSync(lockPath)).toBe(false)
  })

  it('forceReleaseLock refuses when PID changed (TOCTOU)', async () => {
    const handle = await acquireLock(lockPath)
    const wrongPid = handle.pid + 1
    await expect(forceReleaseLock(lockPath, wrongPid, dir)).rejects.toThrow(/PID|changed/i)
    await handle.release()
  })

  it('forceReleaseLock refuses to unlink symlinks', async () => {
    const { symlinkSync } = await import('node:fs')
    const target = join(dir, 'victim.txt')
    writeFileSync(target, 'precious')
    symlinkSync(target, lockPath)
    await expect(forceReleaseLock(lockPath, 999, dir)).rejects.toThrow(/symlink/i)
    expect(readFileSync(target, 'utf-8')).toBe('precious')
  })

  it('forceReleaseLock rejects path escaping cwd', async () => {
    const escaping = '/etc/passwd'
    await expect(forceReleaseLock(escaping, 123, dir)).rejects.toThrow(/escape|outside/i)
  })

  // ── Display sanitization ──────────────────────────────────────────────────

  it('contention error sanitizes ANSI/newline from lock cmd field', async () => {
    const evil: LockInfo = {
      pid: process.pid,
      hostname: os.hostname(),
      bootId: 'b',
      startedAt: new Date().toISOString(),
      cmd: 'arbiter init\x1b[31m INJECTED\x1b[0m\nevil',
      nonce: 'n',
    }
    writeFileSync(lockPath, JSON.stringify(evil))

    vi.spyOn(process, 'kill').mockReturnValue(true)

    let errMsg = ''
    try {
      await acquireLock(lockPath)
    } catch (e) {
      errMsg = (e as Error).message
    }
    expect(errMsg).not.toContain('\x1b')
    expect(errMsg).not.toContain('\nevil')
  })
})
