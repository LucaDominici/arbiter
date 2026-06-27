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

const CLEANUP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

/**
 * Per-process registry of locks this process currently holds, keyed by the
 * resolved lock path.
 *
 * Makes `acquireLock` REENTRANT (#1617): a same-process re-acquire of a path
 * already held is a ref-counted no-op instead of self-deadlocking on the
 * exclusive `openSync(path, 'wx')`. Non-reentrancy was exactly what forced the
 * two-lock-file workaround in #1517 (`.arbiter/.lock` vs `kit.lock`); with a
 * reentrant primitive a single command lock can be held across an entire
 * `loadConfig → mutate → save` without a nested acquire deadlocking.
 *
 * Each entry also carries the acquirer's `nonce` so every delete path can be
 * ownership-checked (#1636) — `deleteLock` only unlinks when the on-disk lock
 * still bears our nonce, so a stale-takeover handoff cannot make our cleanup
 * unlink another holder's lock.
 */
interface HeldLock {
  count: number
  nonce: string
  deleteLock: () => void
  signalCleanup: () => void
}

const heldLocks = new Map<string, HeldLock>()

/**
 * Build the shared release handle for a held lock. Reentrant acquires return
 * one of these per call; each `release()` decrements the ref-count and only the
 * final release detaches the exit/signal handlers and unlinks the lockfile.
 * Idempotent: a double `release()` on the same handle is a no-op.
 */
function makeLockHandle(key: string, lockPath: string): LockHandle {
  let released = false
  return {
    path: lockPath,
    pid: process.pid,
    release: (): Promise<void> => {
      if (released) return Promise.resolve()
      released = true
      const held = heldLocks.get(key)
      if (!held) return Promise.resolve()
      held.count -= 1
      if (held.count <= 0) {
        process.removeListener('exit', held.deleteLock)
        for (const sig of CLEANUP_SIGNALS) process.removeListener(sig, held.signalCleanup)
        heldLocks.delete(key)
        held.deleteLock()
      }
      return Promise.resolve()
    },
  }
}

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
  const key = resolve(lockPath)

  // Reentrant fast-path (#1617): this process already holds the lock → bump the
  // ref-count and hand back a release handle. No second `openSync('wx')`, so a
  // command holding the lock can re-acquire it (directly or via a nested writer)
  // without self-deadlocking. Cross-process exclusion is unaffected — the
  // registry is per-process; other processes still contend on the filesystem.
  const alreadyHeld = heldLocks.get(key)
  if (alreadyHeld) {
    alreadyHeld.count += 1
    return makeLockHandle(key, lockPath)
  }

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

  const ourNonce = info.nonce

  // Ownership-checked deletion (#1636): only unlink when the on-disk lock still
  // bears OUR nonce. After a legitimate stale-takeover, a later process owns the
  // lockfile with a different nonce; our `release()`/exit/signal cleanup must not
  // unlink it, or two holders could run concurrently.
  function deleteLock(): void {
    try {
      if (readLockInfo(lockPath)?.nonce === ourNonce) {
        unlinkSync(lockPath)
      }
    } catch {
      /* best-effort */
    }
  }

  const signalCleanup = (): void => {
    try {
      deleteLock()
    } catch {
      /* best-effort */
    }
    process.exit(130)
  }

  process.once('exit', deleteLock)
  for (const sig of CLEANUP_SIGNALS) {
    process.once(sig, signalCleanup)
  }

  heldLocks.set(key, { count: 1, nonce: ourNonce, deleteLock, signalCleanup })

  return makeLockHandle(key, lockPath)
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
