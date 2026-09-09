// SPDX-License-Identifier: Apache-2.0
/**
 * #2402 — "complete" means the PR is merged, verified rather than asserted.
 *
 * A PR was opened with red CI and abandoned: `ship.md` prescribes the merge watcher, but nothing
 * stopped the task document from reaching `complete` while the branch sat unmerged on the remote.
 * The Iron Law already says complete-means-merged-to-main; this is the mechanical form of it.
 *
 * Pure and deterministic: the caller runs `gh` and hands the parsed snapshots in, which is what
 * makes the refusal testable without a network, a repo, or an authenticated CLI.
 *
 * CANON-16 existing-code survey: `classify()` in `scripts/pr-merge-watch.mjs` reads the same
 * `statusCheckRollup` but answers a different question (green / hard-fail / PENDING, to decide
 * whether to keep polling) and lives in the generated script tree, unimportable from `src/`.
 * `validatePromotion()` guards a merge already in flight. Neither decides whether a landing
 * happened, which is the only question here.
 */

/** The `gh pr list --json number,state,mergeStateStatus,statusCheckRollup` row shape. */
export interface PrSnapshot {
  number: number
  state: string
  mergeStateStatus?: string
  headRefOid?: string
  mergeCommit?: { oid: string } | null
  mergedAt?: string | null
  statusCheckRollup?: readonly CiCheck[] | null
}

interface CiCheck {
  name?: string
  context?: string
  conclusion?: string
  state?: string
  createdAt?: string
  completedAt?: string
  checkSuite?: { createdAt?: string } | null
}

export type MergedVerdict = { merged: true; number: number } | { merged: false; detail: string }

/**
 * Conclusions that mean a check RAN and did not pass. Deliberately narrower than the watcher's
 * hard-fail set: this list only names checks in the refusal message, and calling a queued or
 * action-required check "failing" would send the reader after the wrong job.
 */
const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED'])

/** The names of checks that ran and did not pass, in rollup order. */
export function failingCheckNames(pr: PrSnapshot): string[] {
  return (pr.statusCheckRollup ?? [])
    .filter((check) => FAILED_CONCLUSIONS.has(check.conclusion ?? ''))
    .map((check) => check.name ?? check.context ?? '(unnamed check)')
}

function unmergedDetail(pr: PrSnapshot): string {
  const failing = failingCheckNames(pr)
  const merge = pr.mergeStateStatus === undefined ? '' : `, mergeStateStatus ${pr.mergeStateStatus}`
  const checks =
    failing.length > 0
      ? ` Failing checks: ${failing.join(', ')}.`
      : ' No check has reported a red conclusion yet.'
  return (
    `PR #${pr.number} is ${pr.state}${merge}, not MERGED.${checks} ` +
    'Watch it to green and merge it (`node scripts/pr-merge-watch.mjs <owner/repo> ' +
    `${pr.number}\`), or pass --no-pr if this repo lands by direct push.`
  )
}

/**
 * Did this branch's change actually land?
 *
 * `--pr <n>` names the PR explicitly for the case a branch carries more than one; without it any
 * MERGED row wins, else the newest, which is what `gh pr list` returns first. A branch with no PR
 * at all is refused separately, because "you never opened one" and "yours is still red" need
 * different next actions.
 */
export function evaluateMerged(
  prs: readonly PrSnapshot[],
  branch: string,
  explicitPr?: number,
  candidateSha?: string,
): MergedVerdict {
  if (candidateSha !== undefined) return evaluateQualifiedMerged(prs, candidateSha, explicitPr)
  if (explicitPr !== undefined) {
    const named = prs.find((pr) => pr.number === explicitPr)
    if (named === undefined) {
      return {
        merged: false,
        detail: `PR #${explicitPr} was not found on branch "${branch}" (\`gh pr list --head ${branch} --state all\` returned ${prs.length} PR(s)).`,
      }
    }
    return named.state === 'MERGED'
      ? { merged: true, number: named.number }
      : { merged: false, detail: unmergedDetail(named) }
  }
  const merged = prs.find((pr) => pr.state === 'MERGED')
  if (merged !== undefined) return { merged: true, number: merged.number }
  const [first] = prs
  if (first === undefined) {
    return {
      merged: false,
      detail:
        `no PR exists for branch "${branch}". Open one and drive it to green before completing, ` +
        'or pass --no-pr if this repo lands by direct push.',
    }
  }
  return { merged: false, detail: unmergedDetail(first) }
}

function evaluateQualifiedMerged(
  prs: readonly PrSnapshot[],
  candidateSha: string,
  explicitPr?: number,
): MergedVerdict {
  const candidate = prs.find(
    (pr) =>
      pr.state === 'MERGED' &&
      pr.headRefOid === candidateSha &&
      (explicitPr === undefined || pr.number === explicitPr),
  )
  if (!candidate || candidate.mergeCommit?.oid !== candidateSha) {
    return {
      merged: false,
      detail: 'Merged PR head/merge refs do not match the qualified candidate SHA.',
    }
  }
  const cutoff = Date.parse(candidate.mergedAt ?? '')
  if (!Number.isFinite(cutoff) || !successfulCiAtMerge(candidate.statusCheckRollup ?? [], cutoff)) {
    return {
      merged: false,
      detail: 'Candidate CI cannot establish successful qualification before merge.',
    }
  }
  return { merged: true, number: candidate.number }
}

function finishedBeforeMerge(check: CiCheck, cutoff: number): boolean {
  const time = Date.parse((check.checkSuite ? check.completedAt : check.createdAt) ?? '')
  return Number.isFinite(time) && time <= cutoff
}

function ciCreatedAt(check: CiCheck): number {
  return Date.parse(check.checkSuite?.createdAt ?? check.createdAt ?? '')
}

function successfulCiAtMerge(checks: readonly CiCheck[], cutoff: number): boolean {
  let success = false
  for (const check of checks) {
    const created = ciCreatedAt(check)
    if (!Number.isFinite(created)) return false
    if (created > cutoff) {
      // A later status-context update cannot establish its earlier state.
      if (!check.checkSuite) return false
      continue
    }
    const outcome = check.conclusion ?? check.state ?? ''
    if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(outcome)) return false
    if (!finishedBeforeMerge(check, cutoff)) return false
    if (outcome === 'SUCCESS') success = true
  }
  return success
}
