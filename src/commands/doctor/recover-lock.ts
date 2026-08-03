// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from doctor.ts — the `arbiter doctor
// recover-lock` subcommand (#618). Pure extraction, no behavior change.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import os from 'node:os'
import { jsonOutput } from '../../utils/json-output.js'
import { t } from '../../i18n/index.js'
import { inspectLock, forceReleaseLock, isLockStale } from '../../utils/file-lock.js'
import type { LockInfo } from '../../utils/file-lock.js'
import { UserFacingError } from '../../utils/errors.js'
import { MANAGED_LOCKS } from './health.js'

// ── doctor recover-lock (#618) ────────────────────────────────────────────────

export interface DoctorRecoverLockOptions {
  dir?: string
  json?: boolean
  /** Deliberately release a lock that cannot be proven stale. */
  force?: boolean
}

export interface DoctorRecoverLockResult {
  found: boolean
  released: boolean
  info?: LockInfo
  corrupt?: boolean
}

interface LockRefusal {
  rel: string
  pid: number
  cmd: string
  age: number
}

interface ManagedLockRecovery extends DoctorRecoverLockResult {
  refusal?: LockRefusal
}

interface RecoverySummary {
  released: boolean
  firstInfo: LockInfo | undefined
  corrupt: boolean
}

const RECOVER_LOCK_STALE_AGE_MS = 6 * 3600_000

function formatRefusalHolders(refusals: LockRefusal[]): string {
  return refusals
    .map(({ rel, pid, cmd, age }) => `${rel} (pid ${pid}, cmd: ${cmd}, age: ${age}s)`)
    .join('; ')
}

function emitRefusedRecovery(
  opts: DoctorRecoverLockOptions,
  refusalMessage: string,
  summary: RecoverySummary,
  refusals: LockRefusal[],
): void {
  if (!opts.json) return
  jsonOutput(
    'doctor recover-lock',
    'error',
    {
      found: true,
      released: summary.released,
      ...(summary.firstInfo ? { info: summary.firstInfo } : {}),
      ...(summary.corrupt ? { corrupt: true } : {}),
      refused: refusals,
    },
    [refusalMessage],
  )
}

function emitRecoveryResult(
  opts: DoctorRecoverLockOptions,
  targetDir: string,
  result: DoctorRecoverLockResult,
): void {
  if (opts.json) {
    jsonOutput('doctor recover-lock', 'ok', {
      found: result.found,
      released: result.released,
      ...(result.info ? { info: result.info } : {}),
      ...(result.corrupt ? { corrupt: true } : {}),
    })
  } else if (!result.found) {
    process.stdout.write(`  No lock file found in ${join(targetDir, '.arbiter')}\n`)
  }
}

async function recoverManagedLock(
  lockPath: string,
  rel: string,
  targetDir: string,
  opts: DoctorRecoverLockOptions,
): Promise<ManagedLockRecovery> {
  if (!existsSync(lockPath)) return { found: false, released: false }

  const info = await inspectLock(lockPath)
  if (!info) {
    if (!opts.json) {
      process.stdout.write(`  Lock found (${rel}): CORRUPT / unreadable; removing it.\n`)
    }
    await forceReleaseLock(lockPath, 0, targetDir, { allowUnreadable: true })
    if (!opts.json) process.stdout.write(`  Corrupt lock released.\n`)
    return { found: true, released: true, corrupt: true }
  }

  if (!opts.json) {
    const age = Math.round((Date.now() - new Date(info.startedAt).getTime()) / 1000)
    const onThisHost = info.hostname === os.hostname() ? 'yes' : 'no'
    process.stdout.write(`  Lock found (${rel}):\n`)
    process.stdout.write(`    pid:       ${info.pid}\n`)
    process.stdout.write(`    hostname:  ${info.hostname}\n`)
    process.stdout.write(`    cmd:       ${info.cmd}\n`)
    process.stdout.write(`    age:       ${age}s\n`)
    process.stdout.write(`    this host: ${onThisHost}\n`)
  }

  if (!opts.force && !isLockStale(info, RECOVER_LOCK_STALE_AGE_MS)) {
    const age = Math.round((Date.now() - new Date(info.startedAt).getTime()) / 1000)
    return {
      found: true,
      released: false,
      info,
      refusal: { rel, pid: info.pid, cmd: info.cmd, age },
    }
  }

  await forceReleaseLock(lockPath, info.pid, targetDir)
  if (!opts.json) process.stdout.write(`  Lock released.\n`)
  return { found: true, released: true, info }
}

export async function runDoctorRecoverLock(
  opts: DoctorRecoverLockOptions = {},
): Promise<DoctorRecoverLockResult> {
  const targetDir = resolve(opts.dir ?? '.')

  // Inspect + release EVERY managed lock (.arbiter/.lock AND .arbiter/kit.lock),
  // so a stale kit.lock that bricks saveConfig is no longer unreachable (#1517).
  let firstInfo: LockInfo | undefined
  let released = false
  let corrupt = false
  const refusals: LockRefusal[] = []

  for (const { rel } of MANAGED_LOCKS) {
    const lockPath = join(targetDir, rel)
    const result = await recoverManagedLock(lockPath, rel, targetDir, opts)
    released ||= result.released
    corrupt ||= result.corrupt === true
    firstInfo ??= result.info
    if (result.refusal) refusals.push(result.refusal)
  }

  if (refusals.length > 0) {
    const holders = formatRefusalHolders(refusals)
    const refusalMessage = t('cli.doctor.recover_lock.refused', { holders })
    emitRefusedRecovery(opts, refusalMessage, { released, firstInfo, corrupt }, refusals)
    throw new UserFacingError(t('cli.doctor.recover_lock.refused', { holders }))
  }

  if (!firstInfo && !corrupt) {
    const result = { found: false, released: false }
    emitRecoveryResult(opts, targetDir, result)
    return result
  }

  const result = {
    found: true,
    released,
    ...(firstInfo ? { info: firstInfo } : {}),
    ...(corrupt ? { corrupt: true } : {}),
  }
  emitRecoveryResult(opts, targetDir, result)
  return result
}
