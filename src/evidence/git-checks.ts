// SPDX-License-Identifier: Apache-2.0
import { runCli } from '../utils/run-cli.js'

// Pre-push hook rsyncs to a '#'-free temp dir without .git when the worktree
// path contains '#'. ARBITER_HOOK_GIT_CWD points back to the real repo so git
// queries against test-commit SHAs still resolve.
export function gitCwd(dir?: string): string {
  return process.env.ARBITER_HOOK_GIT_CWD || dir || process.cwd()
}

export function shaExistsOnBranch(sha: string, dir?: string): boolean {
  try {
    const result = runCli('git', ['cat-file', '-e', sha], {
      cwd: gitCwd(dir),
      timeoutMs: 5000,
    })
    return result.exitCode === 0
  } catch {
    return false
  }
}

/**
 * True when the working tree or index has uncommitted changes under
 * `__tests__/**` (staged or unstaged, tracked or untracked). Used to refuse
 * `record-red` before the evidence's `test_commit_sha` can point at a commit
 * that does not yet contain the RED test (#1988).
 */
export function hasDirtyTestPaths(dir?: string): boolean {
  try {
    const result = runCli(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--', '__tests__'],
      { cwd: gitCwd(dir), timeoutMs: 5000 },
    )
    return result.exitCode === 0 && result.stdout.trim().length > 0
  } catch {
    return false
  }
}

export function pathExistsInCommit(sha: string, path: string, dir?: string): boolean {
  try {
    const result = runCli('git', ['ls-tree', '--name-only', sha, path], {
      cwd: gitCwd(dir),
      timeoutMs: 5000,
    })
    return result.exitCode === 0 && result.stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Trimmed stdout of a `git` query, or 'unknown' outside a git work tree (#1212). */
function gitValue(args: readonly string[], dir?: string): string {
  try {
    const result = runCli('git', [...args], { cwd: gitCwd(dir), timeoutMs: 5000 })
    const out = result.stdout.trim()
    return result.exitCode === 0 && out.length > 0 ? out : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Symbolic name of the current branch, or 'unknown' outside a git work tree (#1212). */
export function currentBranch(dir?: string): string {
  return gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
}

/** Full SHA of HEAD, or 'unknown' outside a git work tree (#1212). */
export function headSha(dir?: string): string {
  return gitValue(['rev-parse', 'HEAD'], dir)
}
