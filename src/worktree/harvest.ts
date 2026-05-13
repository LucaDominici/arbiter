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

  const changedFiles: string[] = []
  for (const line of statusOutput.split('\n')) {
    // Extract the filename from porcelain status.
    // Format: "XY filename" where X and Y are each one character.
    // X = staging area status, Y = working tree status.
    // Examples: " M file" (unstaged mod), "M  file" (staged mod),
    //           "?? file" (untracked), "A  file" (newly added)
    // Do NOT trim — the leading space is significant (X=' ' means not staged).
    if (!line) continue

    // Untracked files: "?? path"
    if (line.startsWith('?? ')) {
      changedFiles.push(line.slice(3))
      continue
    }

    // Staged or modified files: "XY path" — filename starts at column 3
    const filePath = line.slice(3)
    if (filePath) {
      changedFiles.push(filePath)
    }
  }

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
