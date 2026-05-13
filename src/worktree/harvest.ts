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
 * Parse `git status --porcelain` output into a list of file paths.
 *
 * Handles untracked ("?? path"), renamed/copied ("R  old -> new"), and
 * staged/modified ("XY path") entries.  For rename/copy entries only the
 * destination path is returned — the source no longer exists in the worktree.
 */
function parsePorcelainStatus(output: string): string[] {
  const files: string[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const xy = line.slice(0, 2)
    if (xy === '??') {
      files.push(line.slice(3))
    } else if (xy[0] === 'R' || xy[0] === 'C') {
      // "R  old -> new" — extract destination after " -> "
      const arrow = line.indexOf(' -> ')
      if (arrow !== -1) files.push(line.slice(arrow + 4))
    } else {
      const filePath = line.slice(3)
      if (filePath) files.push(filePath)
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
  // Do NOT trim the full output — leading spaces per line are significant
  // in porcelain format (" M" = unstaged modification, "M " = staged).
  // Use --untracked-files=all to list individual files inside untracked directories
  // (default shows only the directory name, which we can't copy).
  const statusOutput = runCli('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: worktreePath,
  }).stdout

  if (!statusOutput.trim()) {
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
