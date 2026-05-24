// SPDX-License-Identifier: Apache-2.0
import { runCli } from '../utils/run-cli.js'

// Pre-push hook rsyncs to a '#'-free temp dir without .git when the worktree
// path contains '#'. ARBITER_HOOK_GIT_CWD points back to the real repo so git
// queries against test-commit SHAs still resolve.
function gitCwd(dir?: string): string {
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
