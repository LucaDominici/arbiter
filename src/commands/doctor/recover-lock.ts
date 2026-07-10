// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from doctor.ts — the `arbiter doctor
// recover-lock` subcommand (#618). Pure extraction, no behavior change.
import { join, resolve } from 'node:path'
import os from 'node:os'
import { jsonOutput } from '../../utils/json-output.js'
import { inspectLock, forceReleaseLock } from '../../utils/file-lock.js'
import type { LockInfo } from '../../utils/file-lock.js'
import { MANAGED_LOCKS } from './health.js'

// ── doctor recover-lock (#618) ────────────────────────────────────────────────

export interface DoctorRecoverLockOptions {
  dir?: string
  json?: boolean
}

export interface DoctorRecoverLockResult {
  found: boolean
  released: boolean
  info?: LockInfo
}

export async function runDoctorRecoverLock(
  opts: DoctorRecoverLockOptions = {},
): Promise<DoctorRecoverLockResult> {
  const targetDir = resolve(opts.dir ?? '.')

  // Inspect + release EVERY managed lock (.arbiter/.lock AND .arbiter/kit.lock),
  // so a stale kit.lock that bricks saveConfig is no longer unreachable (#1517).
  let firstInfo: LockInfo | undefined
  let released = false

  for (const { rel } of MANAGED_LOCKS) {
    const lockPath = join(targetDir, rel)
    const info = await inspectLock(lockPath)
    if (!info) continue

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

    await forceReleaseLock(lockPath, info.pid, targetDir)
    released = true
    firstInfo ??= info
    if (!opts.json) process.stdout.write(`  Lock released.\n`)
  }

  if (!firstInfo) {
    if (opts.json) {
      jsonOutput('doctor recover-lock', 'ok', { found: false, released: false })
    } else {
      process.stdout.write(`  No lock file found in ${join(targetDir, '.arbiter')}\n`)
    }
    return { found: false, released: false }
  }

  if (opts.json) {
    jsonOutput('doctor recover-lock', 'ok', { found: true, released, info: firstInfo })
  }
  return { found: true, released, info: firstInfo }
}
