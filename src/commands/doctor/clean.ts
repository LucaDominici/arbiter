// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from doctor.ts — the `arbiter doctor clean`
// subcommand (#1217). Pure extraction, no behavior change.
import { realpathSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { walkDir } from '../../utils/walk-dir.js'
import { jsonOutput } from '../../utils/json-output.js'

// ── doctor clean (#1217) ─────────────────────────────────────────────────────

export interface DoctorCleanOptions {
  dir?: string
  dryRun?: boolean
  json?: boolean
}

export interface DoctorCleanResult {
  found: string[]
  deleted: string[]
}

const CLEAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])

function isBackupFile(name: string): boolean {
  return name.endsWith('.arbiter-backup') || /^\.arbiter-generated\.json\.bak\./.test(name)
}

function collectBackups(dir: string, out: string[]): void {
  // Shared Dirent walk: symlink-safe by construction, same skip/filter/error policy as before. #1521.
  out.push(
    ...walkDir(dir, {
      skipDirs: CLEAN_SKIP_DIRS,
      filter: (name) => isBackupFile(name),
      errorMode: 'fs-soft',
    }),
  )
}

export function runDoctorClean(opts: DoctorCleanOptions = {}): DoctorCleanResult {
  const rawDir = resolve(opts.dir ?? '.')
  let targetDir: string
  try {
    targetDir = realpathSync(rawDir)
  } catch {
    targetDir = rawDir
  }

  const found: string[] = []
  collectBackups(targetDir, found)

  const deleted: string[] = []
  if (!opts.dryRun) {
    for (const f of found) {
      try {
        unlinkSync(f)
        deleted.push(f)
      } catch {
        // skip files we can't delete
      }
    }
  }

  if (opts.json) {
    jsonOutput('doctor clean', 'ok', { found, deleted })
  }

  return { found, deleted }
}
