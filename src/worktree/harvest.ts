// SPDX-License-Identifier: Apache-2.0
import { cpSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runCli } from '../utils/run-cli.js'

export interface HarvestResult {
  /** Files successfully copied from worktree to main repo */
  copied: string[]
  /** Files skipped because the main repo copy has uncommitted changes */
  skipped: string[]
}

export interface HarvestOptions {
  /** Absolute path to the worktree */
  worktreePath: string
  /** Absolute path to the main repository */
  mainRepoPath: string
  /** Auto-confirm all files without prompting (for non-interactive use) */
  autoConfirm?: boolean
  /** Callback for each file action */
  onFile?: (file: string, action: 'copy' | 'skip') => void
}

/**
 * Parse `git status --porcelain=v1 -z` output into a list of file paths.
 *
 * Under `-z`, records are NUL-terminated and paths are NOT quoted, so filenames
 * containing spaces, newlines, the substring " -> ", or non-ASCII bytes are
 * round-tripped verbatim (fixes #500, #501).
 *
 * Record layout per `git-status(1)`:
 *   `XY <path>\0`                           — normal / untracked / modified
 *   `R  <new>\0<orig>\0`  or  `C  <new>\0<orig>\0`  — rename / copy: the
 *      destination is in the XY-record and the source follows as its own
 *      NUL-terminated field. Only the destination is returned (the source
 *      no longer exists on disk in the worktree).
 */
function parsePorcelainStatus(output: string): string[] {
  const files: string[] = []
  const records = output.split('\0')
  // The trailing NUL produces a final empty record; ignore by length-1.
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record === undefined || record === '') continue
    const xy = record.slice(0, 2)
    const path = record.slice(3)
    if (xy === '??') {
      if (path) files.push(path)
    } else if (xy[0] === 'R' || xy[0] === 'C') {
      // Destination is in this record; consume the next record (source) and discard.
      if (path) files.push(path)
      i++ // skip source record
    } else {
      if (path) files.push(path)
    }
  }
  return files
}

/**
 * Copy modified and new files from a worktree back to the main repo.
 *
 * Uses `git status --porcelain` to find changed/untracked files in the worktree,
 * then copies each to the main repo unless the main repo copy has uncommitted changes.
 */
export function harvestFiles(opts: HarvestOptions): HarvestResult {
  const { worktreePath, mainRepoPath, onFile } = opts

  const result: HarvestResult = { copied: [], skipped: [] }

  // 1. Get changed files from the worktree
  // Use `-z` so records are NUL-terminated and paths are unquoted — this is
  // the only safe way to consume porcelain when filenames may contain spaces,
  // newlines, or the substring " -> " (fixes #500, #501).
  // Use --untracked-files=all to list individual files inside untracked
  // directories (default shows only the directory name, which we can't copy).
  const statusOutput = runCli('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: worktreePath,
  }).stdout

  if (statusOutput.length === 0) {
    return result // No changes to harvest
  }

  const changedFiles = parsePorcelainStatus(statusOutput)

  if (changedFiles.length === 0) {
    return result
  }

  // 2. For each changed file, copy it back to the main repo
  for (const filePath of changedFiles) {
    const srcPath = join(worktreePath, filePath)
    const destPath = join(mainRepoPath, filePath)

    // Skip if source doesn't exist (e.g., deleted file)
    if (!existsSync(srcPath)) continue

    // Skip directories — they're containers, not content
    if (statSync(srcPath).isDirectory()) continue

    // Check if the destination has uncommitted changes in the main repo
    const destHasChanges = fileHasUncommittedChanges(mainRepoPath, filePath)

    if (destHasChanges) {
      result.skipped.push(filePath)
      onFile?.(filePath, 'skip')
      continue
    }

    // Create parent directories and copy
    mkdirSync(dirname(destPath), { recursive: true })
    cpSync(srcPath, destPath)
    result.copied.push(filePath)
    onFile?.(filePath, 'copy')
  }

  return result
}

/**
 * Check if a file in the main repo has uncommitted changes.
 * Returns true if the file is modified, staged, or has conflicts.
 */
function fileHasUncommittedChanges(mainRepoPath: string, filePath: string): boolean {
  try {
    // git diff --quiet exits 0 if no changes, 1 if there are changes
    runCli('git', ['diff', '--quiet', '--', filePath], {
      cwd: mainRepoPath,
    })
    // Also check staged changes
    runCli('git', ['diff', '--quiet', '--cached', '--', filePath], {
      cwd: mainRepoPath,
    })
    return false
  } catch {
    return true
  }
}
