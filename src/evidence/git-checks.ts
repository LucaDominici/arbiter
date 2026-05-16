// SPDX-License-Identifier: Apache-2.0
import { runCli } from '../utils/run-cli.js'

export function shaExistsOnBranch(sha: string, dir?: string): boolean {
  try {
    const result = runCli('git', ['cat-file', '-e', sha], {
      cwd: dir ?? process.cwd(),
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
      cwd: dir ?? process.cwd(),
      timeoutMs: 5000,
    })
    return result.exitCode === 0 && result.stdout.trim().length > 0
  } catch {
    return false
  }
}
