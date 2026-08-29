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
  statusCheckRollup?: readonly { name?: string; context?: string; conclusion?: string }[] | null
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
): MergedVerdict {
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
