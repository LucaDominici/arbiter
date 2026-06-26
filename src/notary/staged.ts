// SPDX-License-Identifier: Apache-2.0
/**
 * Reads staged git state: files and commit message (from COMMIT_EDITMSG).
 *
 * Uses src/utils/run-cli.ts for all subprocess calls (INV-12/CANON-12).
 *
 * #256
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
 * Returns the in-progress commit message by reading COMMIT_EDITMSG.
 * Returns empty string when unavailable (e.g. not in a commit context).
 *
 * Resolves the path via `git rev-parse --git-path COMMIT_EDITMSG` rather than
 * hand-joining `<cwd>/.git/COMMIT_EDITMSG`. In a primary checkout `.git` is a
 * directory and `--git-path` returns a relative `.git/COMMIT_EDITMSG`; in a git
 * worktree `.git` is a gitdir-pointer FILE and the real COMMIT_EDITMSG lives
 * under `<main>/.git/worktrees/<name>/`, which `--git-path` returns as an
 * absolute path. `resolve(dir, ...)` is correct for both — the old hand-join
 * always returned '' in a worktree, false-failing `arbiter notary check` (#1561).
 */
export function getStagedCommitMessage(cwd?: string): string {
  const dir = cwd ?? process.cwd()
  try {
    const result = runCli('git', ['rev-parse', '--git-path', 'COMMIT_EDITMSG'], {
      cwd: dir,
      timeoutMs: 5000,
    })
    if (result.exitCode !== 0) return ''
    const msgPath = resolve(dir, result.stdout.trim())
    if (!existsSync(msgPath)) return ''
    return readFileSync(msgPath, 'utf-8')
  } catch {
    return ''
  }
}
