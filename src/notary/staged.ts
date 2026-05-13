/**
 * Reads staged git state: files and commit message (from COMMIT_EDITMSG).
 *
 * Uses src/utils/run-cli.ts for all subprocess calls (INV-12/CANON-12).
 *
 * #256
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../utils/run-cli.js'

/**
 * Returns the list of staged file paths that are markdown documents.
 * Uses `git diff --cached --name-only` to read staged files.
 */
export function getStagedDocFiles(cwd?: string): string[] {
  try {
    const result = runCli('git', ['diff', '--cached', '--name-only'], {
      cwd: cwd ?? process.cwd(),
      timeoutMs: 10_000,
    })
    return result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.md'))
  } catch {
    return []
  }
}

/**
 * Returns the in-progress commit message by reading .git/COMMIT_EDITMSG.
 * Returns empty string when unavailable (e.g. not in a commit context).
 */
export function getStagedCommitMessage(cwd?: string): string {
  const gitDir = cwd ? join(cwd, '.git') : join(process.cwd(), '.git')
  const msgPath = join(gitDir, 'COMMIT_EDITMSG')
  if (!existsSync(msgPath)) return ''
  try {
    return readFileSync(msgPath, 'utf-8')
  } catch {
    return ''
  }
}
