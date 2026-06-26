// SPDX-License-Identifier: Apache-2.0
//
// #1259 — issue-correlation AFFINITY scorer for `arbiter ship`.
//
// Ported (re-derived, not copied) from viafera's `/task` correlation analysis
// (start-task §7.3): a pairwise factor score between two issues —
//   +2  same `domain:*` label OR overlapping files
//   +1  same milestone
//   +1  same `type:*` label
// Score ≥ threshold → CORRELATED ; below → low-affinity (warn).
//
// `arbiter ship` ships ONE issue, so affinity is computed as the subject's BEST
// pairwise score against its candidate sibling issues (the CLI supplies open
// same-milestone siblings). The pure scorer here has no I/O; the `gh` fetch lives
// in ./gh-issues.ts so the batch lane (#1263) and the dispatch-matrix lane (#1267)
// can reuse `scoreAffinity`/`computeAffinityReport` over any issue set.
//
// This module is pure (no I/O, no imports of the `gh` adapter) so it never forms
// a cycle with ./gh-issues.ts; the default `gh`-backed fetcher is wired by the
// caller (the `arbiter ship` CLI action / `renderShipAffinityWithGh`).

/** Default correlation threshold (viafera rubric). At/above → correlated. */
export const AFFINITY_THRESHOLD = 3

/** The minimal issue signals the affinity rubric scores over. */
export interface AffinityIssue {
  id: string
  labels: string[]
  milestone?: string
  /** Files the issue is expected to touch (from plan/PR); optional. */
  files?: string[]
}

/** One subject↔candidate pairing and its score. */
interface AffinityPair {
  id: string
  score: number
}

/** Why a report is not correlated (drives the advisory wording). */
type AffinityReason = 'correlated' | 'below-threshold' | 'solo'

export interface AffinityReport {
  subjectId: string
  threshold: number
  /** Highest-scoring candidate, or null when there are no candidates. */
  best: AffinityPair | null
  /** All subject↔candidate scores, highest first. */
  pairs: AffinityPair[]
  correlated: boolean
  reason: AffinityReason
}

function prefixed(labels: string[], prefix: string): Set<string> {
  const out = new Set<string>()
  for (const l of labels) if (l.startsWith(prefix)) out.add(l)
  return out
}

function shareAny(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true
  return false
}

function filesOverlap(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false
  const bs = new Set(b)
  return a.some((f) => bs.has(f))
}

/**
 * Pairwise correlation score between two issues (viafera rubric). Symmetric.
 * The domain/files factor is worth +2 and counted ONCE even if both signals fire
 * or multiple domain labels are shared.
 */
export function scoreAffinity(a: AffinityIssue, b: AffinityIssue): number {
  let score = 0
  const sameDomain = shareAny(prefixed(a.labels, 'domain:'), prefixed(b.labels, 'domain:'))
  if (sameDomain || filesOverlap(a.files, b.files)) score += 2
  if (a.milestone !== undefined && a.milestone === b.milestone) score += 1
  if (shareAny(prefixed(a.labels, 'type:'), prefixed(b.labels, 'type:'))) score += 1
  return score
}

/**
 * Reduce a single subject issue + its candidate siblings to one affinity report.
 * Best score drives correlation; an empty candidate set is `solo` (not correlated).
 */
export function computeAffinityReport(
  subject: AffinityIssue,
  candidates: AffinityIssue[],
  threshold: number = AFFINITY_THRESHOLD,
): AffinityReport {
  const pairs: AffinityPair[] = candidates
    .map((c) => ({ id: c.id, score: scoreAffinity(subject, c) }))
    .sort((x, y) => y.score - x.score)
  const best = pairs[0] ?? null
  let correlated: boolean
  let reason: AffinityReason
  if (best === null) {
    correlated = false
    reason = 'solo'
  } else if (best.score >= threshold) {
    correlated = true
    reason = 'correlated'
  } else {
    correlated = false
    reason = 'below-threshold'
  }
  return { subjectId: subject.id, threshold, best, pairs, correlated, reason }
}

/** Render the affinity report as step-output lines (header always present). */
export function formatAffinityLines(report: AffinityReport): string[] {
  const lines: string[] = []
  const bestStr =
    report.best === null ? 'n/a' : `${report.best.score} (best match ${report.best.id})`
  lines.push(`Affinity: ${bestStr} · threshold ${report.threshold} · ${report.reason}`)

  if (report.pairs.length > 0) {
    const top = report.pairs
      .slice(0, 5)
      .map((p) => `${p.id}=${p.score}`)
      .join(', ')
    lines.push(`  Siblings: ${top}`)
  }

  if (report.reason === 'solo') {
    lines.push('  WARN low affinity: solo ship — no correlated sibling issues found.')
  } else if (!report.correlated) {
    lines.push(
      `  WARN low affinity: best sibling score ${report.best?.score ?? 0} < threshold ${report.threshold}. ` +
        'Verify this issue is well-scoped / not entangled with siblings.',
    )
  }
  return lines
}

/** Injectable fetcher seam — returns the subject + its candidate siblings. */
export type AffinityFetcher = (subjectId: string) => {
  subject: AffinityIssue
  candidates: AffinityIssue[]
}

export interface RenderShipAffinityOpts {
  /** The issue-set loader (tests inject a fake; the CLI injects the `gh` adapter). */
  loadIssues: AffinityFetcher
  threshold?: number
}

/**
 * Compute + render the affinity lines for a ship invocation. ALWAYS returns at
 * least the Affinity header; NEVER throws — a failed load degrades to an
 * "unavailable" advisory so it can never block the ship.
 */
export function renderShipAffinity(subjectId: string, opts: RenderShipAffinityOpts): string[] {
  try {
    const { subject, candidates } = opts.loadIssues(subjectId)
    return formatAffinityLines(computeAffinityReport(subject, candidates, opts.threshold))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [`Affinity: unavailable — could not compute (${msg}).`]
  }
}
