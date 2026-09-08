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
    const result = runCli('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
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

/**
 * True only when a TDD receipt is present in HEAD and a commit since origin/main touched it.
 * A receipt that is merely present in the working tree (or inherited from main) is not branch
 * provenance. verify-tdd still owns the evidence schema and RED re-execution checks.
 */
export function tddEvidenceProducedOnBranch(taskId: string, dir?: string): boolean {
  const path = `.arbiter/evidence/tdd/${taskId}.json`
  if (!pathExistsInCommit('HEAD', path, dir)) return false

  try {
    const status = runCli('git', ['status', '--porcelain', '--untracked-files=all', '--', path], {
      cwd: gitCwd(dir),
      timeoutMs: 5000,
    }).stdout.trim()
    if (status.length > 0) return false
    const base = runCli('git', ['merge-base', 'origin/main', 'HEAD'], {
      cwd: gitCwd(dir),
      timeoutMs: 5000,
    }).stdout.trim()
    if (base.length === 0) return false
    const touched = runCli('git', ['log', '--format=%H', `${base}..HEAD`, '--', path], {
      cwd: gitCwd(dir),
      timeoutMs: 5000,
    }).stdout.trim()
    return touched.length > 0
  } catch {
    // An unresolvable merge-base or git query is unverifiable provenance, never a pass.
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

/** Blob sha of `path` at `sha`, or null when the path is absent there (#2116). */
export function blobShaInCommit(sha: string, path: string, dir?: string): string | null {
  const out = gitValue(['rev-parse', `${sha}:${path}`], dir)
  return /^[0-9a-f]{40}$/i.test(out) ? out : null
}

/** Minimal evidence shape the commit resolution needs. */
export interface EvidenceCommitRef {
  test_commit_sha: string
  test_path: string
  test_blob_sha?: string | undefined
}

interface DegradedEvidenceCommitResolution {
  degraded: true
  reason: string
}

type EvidenceCommitResolution = { sha: string; healed: boolean } | DegradedEvidenceCommitResolution

function isShallowRepository(dir?: string): boolean {
  return gitValue(['rev-parse', '--is-shallow-repository'], dir) === 'true'
}

/**
 * The commit this evidence is about, resolved against the CURRENT branch (#2116).
 *
 * A rebase rewrites every commit sha on a branch but never the test's content, so a
 * sha-only pin becomes unresolvable the moment the branch is rebased — and the RED can
 * rarely be re-recorded afterwards, because the fix is already in the tree. The blob sha
 * of the RED test IS rebase-stable, so when the pinned sha is no longer reachable the
 * history of the test path is searched for the commit carrying identical content.
 *
 * The OLDEST matching commit wins: that is the one that introduced the content — the
 * rebased RED commit itself, not a later commit that merely inherited it.
 *
 * Returns null when neither path resolves. Evidence recorded before the blob pin existed
 * cannot be healed, which is exactly the pre-#2116 behaviour: a loud failure.
 */
export function resolveEvidenceCommit(
  ev: EvidenceCommitRef,
  dir?: string,
): EvidenceCommitResolution | null {
  if (shaExistsOnBranch(ev.test_commit_sha, dir)) {
    return { sha: ev.test_commit_sha, healed: false }
  }
  if (isShallowRepository(dir)) {
    return {
      degraded: true,
      reason:
        'git history is shallow; fetch full history (for GitHub Actions, set actions/checkout fetch-depth: 0) before verifying TDD evidence',
    }
  }
  const blob = ev.test_blob_sha
  if (blob === undefined) return null
  // Searched from HEAD, not from the merge-base: a squash-merged or re-branched history
  // can leave the introducing commit below the base, and a match there is still the RED
  // this evidence describes. It cannot manufacture a false green — the re-execution check
  // runs the recorded command at whatever commit resolves here and fails if it passes.
  const touching = gitValue(['log', '--format=%H', '--max-count=200', '--', ev.test_path], dir)
  if (touching === 'unknown') return null
  // `git log` is newest-first; reverse so the introducing commit is inspected first.
  for (const sha of touching.split('\n').reverse()) {
    if (sha.length === 40 && blobShaInCommit(sha, ev.test_path, dir) === blob) {
      return { sha, healed: true }
    }
  }
  return null
}
