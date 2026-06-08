// SPDX-License-Identifier: Apache-2.0
//
// #1263 — batch ADAPTER for `arbiter ship --batch`. The I/O + composition layer
// over the pure core (./batch.ts): issue-list parsing, date generation, the
// `batch-report-<date>.json` file write, and the default per-issue runner seam.
// Isolated from the pure scorer so the core stays deterministic + LLM-free, exactly
// like src/affinity/gh-issues.ts wraps src/affinity/affinity.ts (#1259).
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  runBatch,
  formatBatchLines,
  type BatchReport,
  type IssueRunner,
  type IssueOutcome,
} from './batch.js'

/** Today's date as a face-value ISO day (YYYY-MM-DD), used for the report filename. */
function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Parse a comma-separated `--batch` issue list into normalised `#<n>` ids.
 * Rejects empty lists, non-numeric, zero and negative ids (mirrors the `--units`
 * parser). Ids flow into `gh`/branch names downstream, so unvalidated free text is
 * a malformed-branch / shell-injection risk (INV-12); only positive integers pass.
 */
export function parseIssueList(raw: string): string[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) {
    throw new Error('--batch requires a non-empty comma-separated list of issue numbers')
  }
  return parts.map((part) => {
    const bare = part.startsWith('#') ? part.slice(1) : part
    const n = Number.parseInt(bare, 10)
    if (Number.isNaN(n) || n <= 0 || String(n) !== bare) {
      throw new Error(`--batch: invalid issue id "${part}" (expected a positive integer)`)
    }
    return `#${n}`
  })
}

/** The date-stamped report filename (relative). */
export function batchReportPath(date: string): string {
  return `batch-report-${date}.json`
}

/**
 * Write the batch report as pretty JSON to `<dir>/batch-report-<date>.json`.
 * Returns the absolute path written.
 */
export function writeBatchReport(dir: string, report: BatchReport): string {
  const path = resolve(dir, batchReportPath(report.date))
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', 'utf-8')
  return path
}

/**
 * DEFAULT per-issue runner — the DOCUMENTED INTEGRATION SEAM. arbiter owns the
 * batch loop + report + per-issue STOP isolation; the live "one fresh sub-agent
 * per issue (clean context)" spawn is supplied by the orchestration harness
 * (the wave-orchestrator prompt / `/ship` loop), which overrides `runIssue`.
 *
 * The default throws so a batch invoked WITHOUT a wired runner fails LOUDLY rather
 * than silently reporting every issue as shipped. The throw is per-issue STOP
 * isolated by the pure core, so each issue is reported as blocked with this reason.
 *
 * #1258 autonomy-levels tie-in: a future autonomy level decides whether the harness
 * may auto-spawn the per-issue sub-agent here (full autonomy) or must hand each
 * issue back for human approval (supervised). The injection point is exactly this seam.
 */
export function defaultIssueRunner(issueId: string): IssueOutcome {
  throw new Error(
    `ship --batch: no per-issue runner wired for ${issueId}. The orchestration harness ` +
      'must supply a clean-context sub-agent runner (see .claude/prompts/opus-4.8-harness-wave-orchestrator.md).',
  )
}

export interface RunShipBatchOptions {
  /** Directory the report is written to. */
  dir: string
  /** The per-issue runner (defaults to the documented integration seam). */
  runIssue?: IssueRunner
  /** Injected date (defaults to today) — overridable for deterministic tests. */
  date?: string
}

export interface RunShipBatchResult {
  report: BatchReport
  reportPath: string
  lines: string[]
}

/**
 * Run a ship batch end-to-end: drive the pure loop over `issueIds` (with per-issue
 * STOP isolation), write the date-stamped report, and return the report + path +
 * human-readable summary lines for the CLI to print.
 */
export function runShipBatch(issueIds: string[], opts: RunShipBatchOptions): RunShipBatchResult {
  const date = opts.date ?? todayIso()
  const runIssue = opts.runIssue ?? defaultIssueRunner
  const report = runBatch(issueIds, { runIssue, date })
  const reportPath = writeBatchReport(opts.dir, report)
  const lines = [...formatBatchLines(report), `Report: ${reportPath}`]
  return { report, reportPath, lines }
}
