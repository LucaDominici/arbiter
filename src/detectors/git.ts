// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../utils/run-cli.js'

export interface GitInfo {
  isGitRepo: boolean
  remoteUrl: string | null
  githubOwner: string | null
  githubRepo: string | null
  projectName: string | null
}

export function detectGitInfo(dir: string): GitInfo {
  const isGitRepo = runCmd('git', ['rev-parse', '--is-inside-work-tree'], dir) === 'true'
  if (!isGitRepo) {
    return {
      isGitRepo: false,
      remoteUrl: null,
      githubOwner: null,
      githubRepo: null,
      projectName: null,
    }
  }

  const remoteUrl = runCmd('git', ['remote', 'get-url', 'origin'], dir)
  const { owner, repo } = parseGithubUrl(remoteUrl ?? '')

  return {
    isGitRepo: true,
    remoteUrl,
    githubOwner: owner,
    githubRepo: repo,
    projectName: repo,
  }
}

// Repo names with dots (e.g. `my.project`) were previously truncated because the prior
// pattern excluded `.` from the repo capture group. The anchored optional `.git` suffix
// already covers the only legitimate trailing dot. (#278 finding #5)
const SSH_RE = /git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/
const HTTPS_RE = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/

function parseGithubUrl(url: string): {
  owner: string | null
  repo: string | null
} {
  const sshMatch = SSH_RE.exec(url)
  if (sshMatch) return { owner: sshMatch[1] ?? null, repo: sshMatch[2] ?? null }

  const httpsMatch = HTTPS_RE.exec(url)
  if (httpsMatch) return { owner: httpsMatch[1] ?? null, repo: httpsMatch[2] ?? null }

  return { owner: null, repo: null }
}

function runCmd(cmd: string, args: string[], cwd: string): string | null {
  try {
    return runCli(cmd, args, { cwd }).stdout.trim()
  } catch {
    return null
  }
}

export type AdverseGitStateType = 'detached-head' | 'rebase' | 'merge' | 'cherry-pick' | 'bisect'

export interface AdverseGitState {
  type: AdverseGitStateType
  message: string
  suggestedFix: string
}

export function detectAdverseGitState(dir: string): AdverseGitState | null {
  const gitDir = runCmd('git', ['rev-parse', '--git-dir'], dir)
  if (!gitDir) return null

  const absGitDir = gitDir.startsWith('/') ? gitDir : join(dir, gitDir)

  if (existsSync(join(absGitDir, 'rebase-merge')) || existsSync(join(absGitDir, 'rebase-apply'))) {
    return {
      type: 'rebase',
      message: 'A git rebase is in progress. arbiter cannot safely write files during a rebase.',
      suggestedFix:
        'Complete or abort the rebase first:\n  git rebase --continue\n  git rebase --abort',
    }
  }

  if (existsSync(join(absGitDir, 'MERGE_HEAD'))) {
    return {
      type: 'merge',
      message: 'A git merge is in progress. arbiter cannot safely write files during a merge.',
      suggestedFix:
        'Complete or abort the merge first:\n  git merge --continue\n  git merge --abort',
    }
  }

  if (existsSync(join(absGitDir, 'CHERRY_PICK_HEAD'))) {
    return {
      type: 'cherry-pick',
      message:
        'A git cherry-pick is in progress. arbiter cannot safely write files during a cherry-pick.',
      suggestedFix:
        'Complete or abort the cherry-pick first:\n  git cherry-pick --continue\n  git cherry-pick --abort',
    }
  }

  if (existsSync(join(absGitDir, 'BISECT_LOG'))) {
    return {
      type: 'bisect',
      message: 'A git bisect is in progress. arbiter cannot safely write files during a bisect.',
      suggestedFix: 'Finish the bisect first:\n  git bisect reset',
    }
  }

  const symref = runCmd('git', ['symbolic-ref', '--quiet', 'HEAD'], dir)
  if (symref === null) {
    const sha = runCmd('git', ['rev-parse', '--short', 'HEAD'], dir) ?? 'unknown'
    return {
      type: 'detached-head',
      message: `HEAD is detached at ${sha}. arbiter cannot safely write files in detached HEAD state.`,
      suggestedFix:
        'Checkout a branch first:\n  git checkout <branch-name>\n  git checkout -b <new-branch-name>',
    }
  }

  return null
}
