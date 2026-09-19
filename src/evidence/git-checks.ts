// SPDX-License-Identifier: Apache-2.0
import { runCli, type RunCliResult } from '../utils/run-cli.js'

// Pre-push hook rsyncs to a '#'-free temp dir without .git when the worktree
// path contains '#'. ARBITER_HOOK_GIT_CWD points back to the real repo so git
// queries against test-commit SHAs still resolve.
export function gitCwd(dir?: string): string {
  return process.env.ARBITER_HOOK_GIT_CWD || dir || process.cwd()
}

type GitQuery<T> = { ok: true; value: T } | { ok: false; reason: string }

function gitQuery(args: readonly string[], dir?: string): GitQuery<RunCliResult> {
  try {
    const result = runCli('git', [...args], { cwd: gitCwd(dir), timeoutMs: 5000 })
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim()
      return {
        ok: false,
        reason: `git ${args.join(' ')} failed with exit ${result.exitCode}${detail ? `: ${detail}` : ''}`,
      }
    }
    return { ok: true, value: result }
  } catch (err) {
    return {
      ok: false,
      reason: `git ${args.join(' ')} failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function shaExistsOnBranch(sha: string, dir?: string): boolean {
  return gitQuery(['merge-base', '--is-ancestor', sha, 'HEAD'], dir).ok
}

/**
 * Inspect one recorded test path for staged, unstaged, or untracked changes.
 * Used to refuse `record-red` before `test_commit_sha` can point at a commit
 * that does not yet contain the RED test (#1988).
 */
export function dirtyTestPathStatus(dir?: string, testPath = '__tests__'): GitQuery<boolean> {
  const result = gitQuery(['status', '--porcelain', '--untracked-files=all', '--', testPath], dir)
  return result.ok ? { ok: true, value: result.value.stdout.trim().length > 0 } : result
}

export function hasDirtyTestPaths(dir?: string, testPath = '__tests__'): boolean {
  const result = dirtyTestPathStatus(dir, testPath)
  // The boolean compatibility helper is used by read-only gates. An inability
  // to inspect Git must never be interpreted as a clean path.
  return !result.ok || result.value
}

export function commitPathStatus(sha: string, path: string, dir?: string): GitQuery<boolean> {
  const result = gitQuery(['ls-tree', '--name-only', sha, path], dir)
  return result.ok ? { ok: true, value: result.value.stdout.trim().length > 0 } : result
}

export function pathExistsInCommit(sha: string, path: string, dir?: string): boolean {
  const result = commitPathStatus(sha, path, dir)
  return result.ok && result.value
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
    const statusResult = dirtyTestPathStatus(dir, path)
    if (!statusResult.ok || statusResult.value) return false
    const baseResult = gitQuery(['merge-base', 'origin/main', 'HEAD'], dir)
    if (!baseResult.ok) return false
    const base = baseResult.value.stdout.trim()
    if (base.length === 0) return false
    const touchedResult = gitQuery(['log', '--format=%H', `${base}..HEAD`, '--', path], dir)
    if (!touchedResult.ok) return false
    const touched = touchedResult.value.stdout.trim()
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
