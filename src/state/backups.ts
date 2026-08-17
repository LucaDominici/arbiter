// SPDX-License-Identifier: Apache-2.0
/**
 * Snapshot backup rotation (#607 #619).
 *
 * Each write of `.arbiter-generated.json` snapshots the previous content
 * to `.arbiter-generated.json.bak.<iso-ts>` and prunes any backups beyond
 * the most recent N. Caller responsibility: invoke `rotateBackup` BEFORE
 * writing the new snapshot.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFileTranslated, unlinkTranslated } from '../utils/fs.js'
import { basename, dirname, join } from 'node:path'

export const DEFAULT_BACKUP_CAP = 10

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function backupSuffix(path: string): RegExp {
  const base = basename(path).replace(/[.+*?^$()[\]{}|\\]/g, '\\$&')
  return new RegExp(`^${base}\\.bak\\.`)
}

export function listBackups(path: string): string[] {
  const dir = dirname(path)
  if (!existsSync(dir)) return []
  const re = backupSuffix(path)
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

export interface RotateBackupOptions {
  cap?: number
}

/**
 * Copy the current snapshot to a timestamped `.bak.<ts>` file, then prune
 * the oldest backups so at most `cap` remain. No-op when the source file
 * does not exist (fresh project, first write).
 */
export function rotateBackup(path: string, opts: RotateBackupOptions = {}): string | null {
  const cap = opts.cap ?? DEFAULT_BACKUP_CAP
  if (!existsSync(path)) return null
  const backupPath = `${path}.bak.${isoTimestamp()}`
  copyFileTranslated(path, backupPath)
  const all = listBackups(path)
  if (all.length > cap) {
    const overflow = all.slice(0, all.length - cap)
    for (const old of overflow) {
      try {
        unlinkTranslated(old)
      } catch {
        // best-effort prune; never block the write
      }
    }
  }
  return backupPath
}
