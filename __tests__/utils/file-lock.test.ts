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

  it('second acquire rejects when lock is held', async () => {
    const handle = await acquireLock(lockPath)
    await expect(acquireLock(lockPath)).rejects.toThrow()
    await handle.release()
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

  it('treats lock as stale when age exceeds 1h', async () => {
    const oldPid = 7777
    const stale: LockInfo = {
      pid: oldPid,
      hostname: os.hostname(),
      bootId: 'same-boot-id',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      cmd: 'arbiter update',
      nonce: 'old',
    }
    writeFileSync(lockPath, JSON.stringify(stale))

    vi.spyOn(process, 'kill').mockReturnValue(true)

    const handle = await acquireLock(lockPath)
    expect(existsSync(lockPath)).toBe(true)
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
