// SPDX-License-Identifier: Apache-2.0
import {
  openSync,
  writeSync,
  closeSync,
  readFileSync,
  unlinkSync,
  renameSync,
  lstatSync,
  existsSync,
} from 'node:fs'
import { resolve } from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { ArbiterError } from './errors.js'

export interface LockInfo {
  pid: number
  hostname: string
  bootId: string
  startedAt: string
  cmd: string
  nonce: string
}

export interface LockHandle {
  readonly path: string
  readonly pid: number
  release(): Promise<void>
}

interface AcquireOpts {
  staleAgeMs?: number
}

const DEFAULT_STALE_MS = 60 * 60 * 1000 // 1 hour

function readBootId(): string {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim()
  } catch {
    return 'unknown'
  }
}

function currentBootId(): string {
  return readBootId()
}

function sanitize(s: string): string {
  return s
    .replaceAll('\x1b', ' ')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 200)
}

function readLockInfo(path: string): LockInfo | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.hostname !== 'string' ||
      typeof parsed.bootId !== 'string' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.cmd !== 'string' ||
      typeof parsed.nonce !== 'string'
    ) {
      return null
    }
    return parsed as unknown as LockInfo
  } catch {
    return null
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function isPidAlive(pid: number): boolean | 'unknown-user' {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return 'unknown-user'
    return false
  }
}

function isStale(info: LockInfo, staleAgeMs: number): boolean {
  if (info.hostname !== os.hostname()) return false
  if (info.bootId !== currentBootId()) return true
  const age = Date.now() - new Date(info.startedAt).getTime()
  if (age > staleAgeMs) return true
  const alive = isPidAlive(info.pid)
  if (alive === 'unknown-user') return false
  return !alive
}

function writeLockExclusive(path: string, info: LockInfo): void {
  const content = JSON.stringify(info)
  let fd: number
  try {
    fd = openSync(path, 'wx')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      const err = ArbiterError.fromKey('E_LOCK_CONFLICT', 'errors.E_LOCK_CONFLICT', { path })
      err.name = 'LockConflictError'
      throw err
    }
    throw e
  }
  try {
    writeSync(fd, content)
  } finally {
    closeSync(fd)
  }
}

function buildLockInfo(): LockInfo {
  return {
    pid: process.pid,
    hostname: os.hostname(),
    bootId: currentBootId(),
    startedAt: new Date().toISOString(),
    cmd: process.argv.slice(1).join(' ').slice(0, 200),
    nonce: randomBytes(8).toString('hex'),
  }
}

function tryTakeover(lockPath: string, info: LockInfo, staleAgeMs: number): boolean {
  if (info.hostname !== os.hostname()) return false
  if (!isStale(info, staleAgeMs)) return false

  const staleMarker = `${lockPath}.stale-${process.pid}-${randomBytes(4).toString('hex')}`
  try {
    renameSync(lockPath, staleMarker)
  } catch {
    return false
  }
  try {
    unlinkSync(staleMarker)
  } catch {
    // best-effort stale cleanup
  }
  return true
}

export async function acquireLock(lockPath: string, opts: AcquireOpts = {}): Promise<LockHandle> {
  const staleAgeMs = opts.staleAgeMs ?? DEFAULT_STALE_MS

  if (isSymlink(lockPath)) {
    throw ArbiterError.fromKey('E_LOCK_SYMLINK', 'errors.E_LOCK_SYMLINK', { path: lockPath })
  }

  const info = buildLockInfo()

  const attempt = async (retries: number): Promise<void> => {
    try {
      writeLockExclusive(lockPath, info)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      const isConflict = code === 'EEXIST' || (e instanceof Error && e.name === 'LockConflictError')
      if (!isConflict || retries === 0) throw e

      const existing = readLockInfo(lockPath)
      if (!existing) {
        await attempt(retries - 1)
        return
      }

      if (existing.hostname !== os.hostname()) {
        throw ArbiterError.fromKey('E_LOCK_FOREIGN_HOST', 'errors.E_LOCK_FOREIGN_HOST', {
          host: sanitize(existing.hostname),
        })
      }

      const took = tryTakeover(lockPath, existing, staleAgeMs)
      if (took) {
        await attempt(retries - 1)
        return
      }

      const age = Math.round((Date.now() - new Date(existing.startedAt).getTime()) / 1000)
      throw ArbiterError.fromKey('E_LOCK_BUSY', 'errors.E_LOCK_BUSY', {
        pid: existing.pid,
        host: sanitize(existing.hostname),
        cmd: sanitize(existing.cmd),
        age,
      })
    }
  }

  await attempt(3)

  function deleteLock(): void {
    try {
      unlinkSync(lockPath)
    } catch {
      /* best-effort */
    }
  }

  process.once('exit', deleteLock)

  const signalCleanup = (): void => {
    try {
      deleteLock()
    } catch {
      /* best-effort */
    }
    process.exit(130)
  }
  const CLEANUP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const sig of CLEANUP_SIGNALS) {
    process.once(sig, signalCleanup)
  }

  return {
    path: lockPath,
    pid: process.pid,
    release: (): Promise<void> => {
      process.removeListener('exit', deleteLock)
      for (const sig of CLEANUP_SIGNALS) {
        process.removeListener(sig, signalCleanup)
      }
      deleteLock()
      return Promise.resolve()
    },
  }
}

export function inspectLock(lockPath: string): Promise<LockInfo | null> {
  if (!existsSync(lockPath)) return Promise.resolve(null)
  return Promise.resolve(readLockInfo(lockPath))
}

export function forceReleaseLock(
  lockPath: string,
  expectedPid: number,
  _rootDir?: string,
): Promise<void> {
  const cwd = _rootDir ?? process.cwd()
  const resolved = resolve(lockPath)
  if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
    return Promise.reject(
      ArbiterError.fromKey('E_LOCK_PATH_ESCAPE', 'errors.E_LOCK_PATH_ESCAPE', { path: resolved }),
    )
  }

  if (isSymlink(lockPath)) {
    return Promise.reject(
      ArbiterError.fromKey('E_LOCK_SYMLINK_UNLINK', 'errors.E_LOCK_SYMLINK_UNLINK', {
        path: lockPath,
      }),
    )
  }

  const info = readLockInfo(lockPath)
  if (!info) {
    return Promise.reject(
      ArbiterError.fromKey('E_LOCK_UNREADABLE', 'errors.E_LOCK_UNREADABLE', { path: lockPath }),
    )
  }

  if (info.pid !== expectedPid) {
    return Promise.reject(
      ArbiterError.fromKey('E_LOCK_PID_CHANGED', 'errors.E_LOCK_PID_CHANGED', {
        expected: expectedPid,
        found: info.pid,
      }),
    )
  }

  unlinkSync(lockPath)
  return Promise.resolve()
}
