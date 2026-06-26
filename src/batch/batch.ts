// SPDX-License-Identifier: Apache-2.0
//
// #1263 — pure batch CORE for `arbiter ship --batch` (native overnight multi-issue mode).
//
// Ports the wave-orchestrator pattern (.claude/prompts/opus-4.8-harness-wave-orchestrator.md)
// from a prompt into a first-class feature: process N issues unattended, ONE fresh
// sub-agent per issue (clean context), per-issue STOP isolation, aggregating a
// `batch-report-<date>.json`.
//
// This module is PURE (no I/O, no spawning, never reads the clock) so it is fully
// unit-testable with a stubbed per-issue runner and never requires a live LLM. The
// real sub-agent spawn + the report file-write live in the adapter (./batch-runner.ts).
// Mirrors the pure-core + adapter + injectable-seam split established by src/affinity/
// (#1259) and src/sizing/ (#1260).
//
// PER-ISSUE STOP ISOLATION (the crux): a throw or blocker on issue k of N is caught,
// recorded as a `blocked` outcome carrying the blocker message, and the loop CONTINUES
// to issue k+1 — the batch is never aborted by one issue's failure. This is the
// multi-issue analog of how affinity/sizing "never throw, degrade".

/** A closed union — an issue either ships or is blocked. No free-text status. */
type IssueStatus = 'shipped' | 'blocked'

/** The outcome the per-issue runner returns (or that isolation synthesises on a throw). */
export interface IssueOutcome {
  issueId: string
  outcome: IssueStatus
  /** The task branch the issue's ship produced, when known. */
  branch?: string
  /** The HEAD sha of the issue's ship, when known. */
  sha?: string
  /** Why the issue is blocked (present iff outcome === 'blocked'). */
  blocker?: string
}

/**
 * Runs ONE issue to a ship outcome. INJECTABLE SEAM: tests stub it; the adapter
 * injects the real ship-driver. Each call models a FRESH sub-agent with a clean
 * context (the clean-context-per-issue contract) — the live LLM spawn is the
 * adapter's documented integration point, not this pure core's concern.
 *
 * A runner MAY throw to signal a STOP/blocker; isolation coerces the throw into a
 * `blocked` outcome so the batch never aborts.
 */
export type IssueRunner = (issueId: string) => IssueOutcome

/** The aggregate batch report (serialised verbatim to batch-report-<date>.json). */
export interface BatchReport {
  /** ISO date (YYYY-MM-DD) the batch ran — INJECTED, never read from the clock here. */
  date: string
  /** Number of issues processed (always === issues.length === succeeded + blocked). */
  total: number
  /** Issues whose runner returned a `shipped` outcome. */
  succeeded: number
  /** Issues blocked (runner returned `blocked` OR threw — isolated). */
  blocked: number
  /** Per-issue outcomes, in the order the issues were supplied. */
  issues: IssueOutcome[]
}

export interface RunBatchOptions {
  /** The per-issue runner (injectable seam). */
  runIssue: IssueRunner
  /** The batch date (injected for determinism; the adapter generates it). */
  date: string
}

/** Coerce any thrown value into a stable blocker message string. */
function blockerMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Run a batch of issues with per-issue STOP isolation, returning the aggregate
 * report. PURE: no I/O, no clock, no spawning. A throw from `runIssue` on any
 * single issue is isolated as a `blocked` outcome and the loop continues — one
 * issue can never abort the batch.
 */
export function runBatch(issueIds: string[], opts: RunBatchOptions): BatchReport {
  const issues: IssueOutcome[] = []
  for (const issueId of issueIds) {
    try {
      const outcome = opts.runIssue(issueId)
      // Defend the closed union even if a runner returns a malformed status.
      issues.push(outcome.outcome === 'shipped' ? outcome : { ...outcome, outcome: 'blocked' })
    } catch (err) {
      // Per-issue STOP isolation: record + continue, never abort the batch.
      issues.push({ issueId, outcome: 'blocked', blocker: blockerMessage(err) })
    }
  }
  const succeeded = issues.filter((i) => i.outcome === 'shipped').length
  const blocked = issues.length - succeeded
  return { date: opts.date, total: issues.length, succeeded, blocked, issues }
}

/** Render the batch report as human-readable summary lines (header always present). */
export function formatBatchLines(report: BatchReport): string[] {
  const lines = [
    `Batch: ${report.total} issue(s) · ${report.succeeded} shipped · ${report.blocked} blocked · ${report.date}`,
  ]
  for (const issue of report.issues) {
    if (issue.outcome === 'blocked') {
      lines.push(`  ${issue.issueId}: BLOCKED — ${issue.blocker ?? 'unknown'}`)
    } else {
      const where = issue.branch ? ` (${issue.branch})` : ''
      lines.push(`  ${issue.issueId}: shipped${where}`)
    }
  }
  return lines
}
