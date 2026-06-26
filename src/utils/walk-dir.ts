// SPDX-License-Identifier: Apache-2.0
/**
 * Shared, symlink-safe recursive directory walker (#1521).
 *
 * Existing Code Survey (CANON-16):
 *   - scripts/lib/glob-walk.mjs `walkRepo` — lstat + skip-symlink-as-file, .mjs only, repo-relative,
 *     swallow-all errors, fixed SKIP_DIRS. Sibling for presence-gate scripts; not importable from TS.
 *   - src/conformance/shared.ts `walkRepo` — lstat + skip-symlink twin, conformance-scoped.
 *   - src/graph/builders/utils.ts `walkFiles` — statSync + dev:ino visited-inode guard; FOLLOWS
 *     symlinks (once) then dedups by inode. Sorted output, predicate over full path.
 *   New util justified: the consumers migrated here (doctor.collectBackups, replay.listFiles) use
 *   `withFileTypes` Dirents — symlink-safe *by construction* (a symlinked dir is never reported as a
 *   directory, so it is never descended; a symlinked file is never reported as a file, so it is never
 *   collected) — and need a flexible (skipDirs / filter / base-relative / readdir error policy)
 *   collect-all walker that none of the three existing helpers provides. Folding either lstat- or
 *   statSync-based twin into Dirent semantics would change their visited sets.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface WalkDirOptions {
  /** Directory base names to prune (never descended). Default: descend every directory. */
  skipDirs?: ReadonlySet<string>
  /** Keep only files for which the predicate returns true. Default: keep every file. */
  filter?: (name: string, fullPath: string) => boolean
  /**
   * When provided, returned paths are sliced relative to this base (`full.slice(base.length + 1)`),
   * matching the legacy callers' relative form. Default: absolute paths.
   */
  base?: string
  /**
   * readdir error policy:
   *   - `'swallow'` (default): unreadable directories are skipped silently (never throws).
   *   - `'fs-soft'`: ENOENT/EACCES are skipped silently; any other errno is rethrown.
   */
  errorMode?: 'swallow' | 'fs-soft'
}

/**
 * Walk `root` recursively, collecting file paths. Uses `withFileTypes` Dirents, so directory
 * symlinks are never descended and symlink leaves are never collected — the walk is inherently
 * cycle-safe (a symlink loop cannot stack-overflow it). Entries are visited in `readdirSync`
 * order; no sorting is applied (callers that need determinism sort the result themselves).
 */
export function walkDir(root: string, options: WalkDirOptions = {}): string[] {
  const { skipDirs, filter, base, errorMode = 'swallow' } = options
  const out: string[] = []
  const visit = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err: unknown) {
      if (errorMode === 'fs-soft') {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'EACCES') return
        throw err
      }
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs || !skipDirs.has(entry.name)) visit(full)
      } else if (entry.isFile()) {
        if (!filter || filter(entry.name, full)) {
          out.push(base !== undefined ? full.slice(base.length + 1) : full)
        }
      }
    }
  }
  visit(root)
  return out
}
