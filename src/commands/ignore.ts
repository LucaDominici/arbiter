// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter ignore add/remove` (#2662) — the CLI surface over `.arbiterignore`
 * (#2353). AC(1): "a declared, reviewable way to retire an emitted file... that
 * update/diff honour and report as retired, not new". `.arbiterignore` already
 * IS that mechanism (a declared, committed, reviewable file update/diff both
 * consult) — what was missing is a way to add/remove a pattern without hand-
 * editing the file, deleting the emitted copy at the same time, and reporting
 * it as `retired` rather than a bare file-write.
 *
 * Deliberately NOT a second retire list: one pattern in `.arbiterignore` is the
 * whole state. No manifest change, no generation session — pure file mutation.
 */
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  anchoredPattern,
  appendIgnorePattern,
  removeIgnorePattern,
  loadIgnorePatterns,
  effectiveIgnorePattern,
} from '../config/arbiter-ignore.js'
import { loadGeneratedManifest } from '../state/generated-manifest.js'
import { unlinkTranslated, readFileTranslated } from '../utils/fs.js'
import { jsonOutput } from '../utils/json-output.js'
import { t } from '../i18n/index.js'

interface IgnoreOptions {
  dir: string | undefined
  paths: string[]
  json?: boolean | undefined
}

/**
 * sha256 of the on-disk file, or `null` when absent. An absent file is a
 * legitimate "nothing to hash" (the caller treats it as already retired) —
 * anything else (EACCES, EISDIR, ...) is a real failure and must surface as a
 * translated ArbiterError rather than being silently read as "absent", which
 * would make `ignore add` report success while never having inspected the
 * file at all (fail-closed audit, INV-96).
 */
function diskHash(path: string): string | null {
  if (!existsSync(path)) return null
  return createHash('sha256').update(readFileTranslated(path)).digest('hex')
}

export function runIgnoreAdd(options: IgnoreOptions): void {
  const targetDir = resolve(options.dir ?? process.cwd())
  const manifest = loadGeneratedManifest(targetDir)
  const retired: string[] = []
  const kept: string[] = []
  for (const key of options.paths) {
    appendIgnorePattern(targetDir, anchoredPattern(key))
    const filePath = join(targetDir, key)
    const baseline = manifest[key]
    const hash = diskHash(filePath)
    if (hash === null) continue // already absent — pattern recorded, nothing to delete
    // Pristine-only, same rule `planRetirement` applies to framework-side
    // retirement: a user-modified file is never deleted on the operator's
    // behalf, only reported so they can salvage it by hand.
    if (baseline !== undefined && hash === baseline) {
      unlinkTranslated(filePath)
      retired.push(key)
    } else {
      kept.push(key)
    }
  }
  if (options.json) {
    jsonOutput('ignore', 'ok', { added: options.paths, retired, kept })
    return
  }
  for (const key of retired) {
    process.stdout.write(`${t('cli.ignore.retired', { key })}\n`)
  }
  for (const key of kept) {
    process.stdout.write(`${t('cli.ignore.kept', { key })}\n`)
  }
}

export function runIgnoreRemove(options: IgnoreOptions): void {
  const targetDir = resolve(options.dir ?? process.cwd())
  const removed: string[] = []
  const stillIgnored: { key: string; by: string }[] = []
  for (const key of options.paths) {
    removeIgnorePattern(targetDir, anchoredPattern(key))
    const remaining = loadIgnorePatterns(targetDir)
    const decidingPattern = effectiveIgnorePattern(remaining, key)
    if (decidingPattern !== null) {
      stillIgnored.push({ key, by: decidingPattern })
    } else {
      removed.push(key)
    }
  }
  if (options.json) {
    jsonOutput('ignore', 'ok', { removed, stillIgnored })
    return
  }
  for (const key of removed) {
    process.stdout.write(`${t('cli.ignore.removed', { key })}\n`)
  }
  for (const { key, by } of stillIgnored) {
    process.stdout.write(`${t('cli.ignore.still_ignored', { key, by })}\n`)
  }
  if (removed.length > 0) {
    process.stdout.write(`${t('cli.ignore.remove_hint')}\n`)
  }
}
