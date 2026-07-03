// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter review plan <file>` (#235).
 *
 * Reads a plan markdown file, dispatches a subagent plan-review pass, and
 * exits with a verdict-based exit code:
 *
 *   0 = PASS     1 = WARN     2 = FAIL
 *
 * Matches the canonical CLI exit-code convention (0=ok, 1=warning,
 * 2=error/blocker — see `src/utils/json-output.ts::statusToExitCode`
 * and `docs/REFERENCE/CLI.md` §Exit codes).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeFileTranslated } from '../utils/fs.js'
import {
  dispatchClaudeAgent,
  dispatchPlanReview,
  emitPlanReviewPrompts,
  makeCodeReviewEvidenceDir,
  sanitizeTaskId,
  submitPlanReview,
  SubmitValidationError,
  type DispatchResult,
  type SubagentDispatcher,
  type SubmittedPass,
  type Verdict,
} from '../review/dispatch.js'
import {
  aggregateFindings,
  buildAgentPrompts,
  dispatchAgents,
  type AgentResult,
  type AggregatedReview,
  type DispatchFn,
} from '../review/multi-agent.js'
import type { ReviewTier } from '../review/tier-constants.js'
import { jsonOutput, type JsonStatus } from '../utils/json-output.js'
import { runCli } from '../utils/run-cli.js'
import { readUnifiedState, readTaskId } from './task-state.js'

export interface ReviewPlanOptions {
  file: string
  dir?: string
  tier?: ReviewTier
  json?: boolean
  /**
   * #1329: when set, write the per-pass reviewer prompts to this directory and
   * exit WITHOUT dispatching `claude`. The orchestrating agent reviews the
   * prompts itself, then records verdicts via `arbiter review submit`.
   */
  emitPrompts?: string
  /** Test hook: inject a fake subagent to avoid spawning `claude`. */
  dispatcher?: SubagentDispatcher
}

export interface ReviewPlanResult {
  exitCode: 0 | 1 | 2
  verdict: DispatchResult['verdict'] | 'ERROR'
  reason?: string
}

function verdictToJsonStatus(verdict: DispatchResult['verdict']): JsonStatus {
  if (verdict === 'PASS') return 'ok'
  if (verdict === 'WARN') return 'warning'
  return 'error'
}

const VALID_TIERS: readonly ReviewTier[] = ['XS', 'S', 'Standard']

function readTierFile(dir: string): ReviewTier | null {
  const raw = readUnifiedState(dir)?.tier.trim() ?? ''
  if (raw.length === 0) return null
  if (raw === 'XS') return 'XS'
  if (raw === 'S') return 'S'
  if (raw === 'M' || raw === 'L' || raw === 'Standard') return 'Standard'
  throw new Error(`Unknown tier "${raw}" in task state. Valid values: XS, S, M, L, Standard.`)
}

function readTaskIdFile(dir: string): string | undefined {
  return readTaskId(dir)
}

interface PlanContext {
  dir: string
  planPath: string
  planContent: string
  tier: ReviewTier
  taskId: string
}

/**
 * Shared preamble for the plan-file review commands (`review plan` and
 * `review submit`, #1329): resolve dir + plan path, load content, resolve tier
 * and task id. Returns `null` when the plan file is missing so each command can
 * format its own not-found envelope. CANON-22: one site, no clone.
 */
function resolvePlanContext(opts: {
  dir?: string
  file: string
  tier?: ReviewTier
}): PlanContext | null {
  const dir = resolve(opts.dir ?? '.')
  const planPath = resolve(opts.file)
  if (!existsSync(planPath)) return null
  const planContent = readFileSync(planPath, 'utf-8')
  const tier: ReviewTier = opts.tier ?? readTierFile(dir) ?? 'XS'
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Invalid tier "${tier}". Valid values: ${VALID_TIERS.join(', ')}.`)
  }
  const taskIdRaw = readTaskIdFile(dir)
  const taskId = taskIdRaw !== undefined ? sanitizeTaskId(taskIdRaw) : 'unknown'
  return { dir, planPath, planContent, tier, taskId }
}

export function runReviewPlan(opts: ReviewPlanOptions): ReviewPlanResult {
  const ctx = resolvePlanContext(opts)
  if (ctx === null) {
    const planPath = resolve(opts.file)
    if (opts.json) {
      jsonOutput('review plan', 'error', { file: planPath }, [`plan file not found: ${planPath}`])
    } else {
      process.stderr.write(`Error: plan file not found: ${planPath}\n`)
    }
    return {
      exitCode: 2,
      verdict: 'ERROR',
      reason: 'plan file not found',
    }
  }
  const { dir, planContent, tier, taskId } = ctx

  if (opts.emitPrompts !== undefined) {
    const emit = emitPlanReviewPrompts({
      planContent,
      dir,
      tier,
      emitDir: resolve(opts.emitPrompts),
      taskId,
    })
    if (opts.json) {
      jsonOutput('review plan', 'ok', {
        emitted: true,
        emitDir: emit.emitDir,
        passCount: emit.passCount,
        promptPaths: emit.promptPaths,
        manifestPath: emit.manifestPath,
        tier,
        taskId,
      })
    } else {
      process.stdout.write(
        `review plan: emitted ${emit.passCount} prompt(s) to ${emit.emitDir} (tier=${tier}). ` +
          `Review each, then run \`arbiter review submit\`.\n`,
      )
    }
    return { exitCode: 0, verdict: 'PASS' }
  }

  const dispatched = dispatchPlanReview({
    planContent,
    dir,
    tier,
    taskId,
    ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
  })

  if (opts.json) {
    jsonOutput('review plan', verdictToJsonStatus(dispatched.verdict), {
      verdict: dispatched.verdict,
      attempts: dispatched.attempts,
      totalInvocations: dispatched.totalInvocations,
      promptPath: dispatched.promptPath,
      tier,
      taskId,
    })
  } else {
    process.stdout.write(
      `review plan: ${dispatched.verdict} (attempts=${dispatched.attempts}, invocations=${dispatched.totalInvocations}, tier=${tier})\n`,
    )
  }

  return {
    exitCode: dispatched.exitCode,
    verdict: dispatched.verdict,
  }
}

/* ───────────────────  review submit (#1329)  ─────────────────── */

export interface ReviewSubmitOptions {
  /** Plan file the verdicts pertain to (recomputes planDigest for the gate). */
  file: string
  dir?: string
  tier?: ReviewTier
  json?: boolean
  /** Agent/human identity recorded as provenance. */
  reviewer: string
  passes: readonly SubmittedPass[]
  manifestPath?: string
}

export interface ReviewSubmitResult {
  exitCode: 0 | 1 | 2
  verdict: Verdict | 'ERROR'
  reason?: string
}

function reportSubmitError(
  json: boolean | undefined,
  ctx: Record<string, unknown>,
  reason: string,
): void {
  if (json) {
    jsonOutput('review submit', 'error', ctx, [reason])
  } else {
    process.stderr.write(`Error: review submit — ${reason}\n`)
  }
}

function reportSubmitSuccess(
  opts: ReviewSubmitOptions,
  tier: ReviewTier,
  taskId: string,
  result: ReturnType<typeof submitPlanReview>,
): void {
  if (opts.json) {
    jsonOutput('review submit', verdictToJsonStatus(result.verdict), {
      verdict: result.verdict,
      tier,
      taskId,
      reviewer: opts.reviewer,
      latestPath: result.latestPath,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    })
    return
  }
  const tail = result.reason !== undefined ? ` — ${result.reason}` : ''
  process.stdout.write(
    `review submit: ${result.verdict} (tier=${tier}, reviewer=${opts.reviewer})${tail}\n`,
  )
}

export function runReviewSubmit(opts: ReviewSubmitOptions): ReviewSubmitResult {
  const ctx = resolvePlanContext(opts)
  if (ctx === null) {
    const reason = `plan file not found: ${resolve(opts.file)}`
    reportSubmitError(opts.json, { file: resolve(opts.file) }, reason)
    return { exitCode: 2, verdict: 'ERROR', reason }
  }
  const { dir, planContent, tier, taskId } = ctx

  let result: ReturnType<typeof submitPlanReview>
  try {
    result = submitPlanReview({
      dir,
      tier,
      planContent,
      passes: opts.passes,
      reviewer: opts.reviewer,
      taskId,
      ...(opts.manifestPath !== undefined ? { manifestPath: resolve(opts.manifestPath) } : {}),
    })
  } catch (err) {
    if (err instanceof SubmitValidationError) {
      reportSubmitError(opts.json, { tier, taskId }, err.message)
      return { exitCode: 2, verdict: 'ERROR', reason: err.message }
    }
    throw err
  }

  reportSubmitSuccess(opts, tier, taskId, result)
  return {
    exitCode: result.exitCode,
    verdict: result.verdict,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
  }
}

/* ─────────────────────────  review code (#236)  ───────────────────────── */

export interface ReviewCodeOptions {
  dir?: string
  tier?: ReviewTier
  json?: boolean
  /** Override git diff target ref (default: "origin/main"). */
  diffRef?: string
  /** Override evidence directory (default: `.evidence/review-<timestamp>/`). */
  evidenceDir?: string
  /** Test hook: pre-computed diff content (skips `git diff`). */
  diffOverride?: string
  /** Test hook: injected dispatcher to avoid spawning `claude`. */
  dispatcher?: DispatchFn
}

export interface ReviewCodeResult {
  exitCode: 0 | 1 | 2
  aggregated: AggregatedReview
  evidenceDir: string
}

function aggregatedToExitCode(agg: AggregatedReview): 0 | 1 | 2 {
  if (agg.blockers.length > 0) return 2
  if (agg.warnings.length > 0) return 1
  // Fail-closed backstop (#1596): every agent must be accounted for — either
  // counted clean (passCount) or having itemized at least one finding. An agent
  // that is neither (passed:false with NO findings) is a malformed / contract-
  // violating reviewer; gating on blocker/warning counts alone would silently
  // resolve it to a green exit 0 in a merge gate. Note: a notes-only agent is
  // itemized (appears in `notes`) so it stays exit 0 — notes are non-blocking.
  const agentsWithFindings = new Set(
    [...agg.blockers, ...agg.warnings, ...agg.notes].map((f) => f.agent),
  )
  if (agg.passCount + agentsWithFindings.size < agg.totalAgents) return 2
  return 0
}

function aggregatedToJsonStatus(agg: AggregatedReview): JsonStatus {
  if (agg.blockers.length > 0) return 'error'
  if (agg.warnings.length > 0) return 'warning'
  return 'ok'
}

function persistAgentResults(evidenceDir: string, results: AgentResult[]): void {
  mkdirSync(evidenceDir, { recursive: true })
  for (const r of results) {
    const path = join(evidenceDir, `agent-${r.agent}.json`)
    // Skip if dispatcher already wrote this file (real dispatchClaudeAgent does).
    if (existsSync(path)) continue
    writeFileTranslated(
      path,
      JSON.stringify(
        {
          agent: r.agent,
          passed: r.passed,
          findings: r.findings,
          rawStdout: r.rawStdout,
        },
        null,
        2,
      ),
    )
  }
}

function resolveDiff(opts: ReviewCodeOptions, dir: string): string {
  if (opts.diffOverride !== undefined) return opts.diffOverride
  const ref = opts.diffRef ?? 'origin/main'
  const result = runCli('git', ['diff', `${ref}...HEAD`], {
    cwd: dir,
    timeoutMs: 60_000,
  })
  return result.stdout
}

/**
 * Build a synthetic blocker-finding result envelope for an infrastructure
 * failure (git diff, prompt build, evidence-dir creation, etc.). These
 * are not agent verdicts — they are pre-dispatch errors that must NOT
 * silently exit with the "no findings" exit code.
 */
function infraFailureResult(err: unknown, evidenceDir: string): ReviewCodeResult {
  const message = err instanceof Error ? err.message : String(err)
  const finding = {
    severity: 'blocker' as const,
    agent: 'infrastructure',
    message: `review-code infra failure: ${message}`,
  }
  const aggregated = {
    blockers: [finding],
    warnings: [],
    notes: [],
    passCount: 0,
    totalAgents: 0,
  }
  return { exitCode: 2, aggregated, evidenceDir }
}

function reportInfraFailure(
  failure: ReviewCodeResult,
  tier: ReviewTier,
  evidenceDir: string,
  json: boolean | undefined,
): void {
  if (json) {
    jsonOutput('review code', 'error', {
      tier,
      exitCode: failure.exitCode,
      blockers: failure.aggregated.blockers,
      warnings: [],
      notes: [],
      passCount: 0,
      totalAgents: 0,
      evidenceDir,
    })
    return
  }
  const fst = failure.aggregated.blockers[0]
  process.stderr.write(`review code: infrastructure failure — ${fst?.message ?? 'unknown'}\n`)
}

export async function runReviewCode(opts: ReviewCodeOptions): Promise<ReviewCodeResult> {
  const dir = resolve(opts.dir ?? '.')
  const tier: ReviewTier = opts.tier ?? 'Standard'
  const evidenceDir = opts.evidenceDir ?? makeCodeReviewEvidenceDir(dir)

  let diff: string
  let prompts: ReturnType<typeof buildAgentPrompts>
  try {
    diff = resolveDiff(opts, dir)
    prompts = buildAgentPrompts({ diff, dir, tier })
  } catch (err) {
    const failure = infraFailureResult(err, evidenceDir)
    reportInfraFailure(failure, tier, evidenceDir, opts.json)
    return failure
  }

  const dispatcher: DispatchFn = opts.dispatcher ?? dispatchClaudeAgent({ evidenceDir })

  const results = await dispatchAgents(prompts, { dispatch: dispatcher })
  persistAgentResults(evidenceDir, results)
  const aggregated = aggregateFindings(results)
  const exitCode = aggregatedToExitCode(aggregated)

  if (opts.json) {
    jsonOutput('review code', aggregatedToJsonStatus(aggregated), {
      tier,
      exitCode,
      blockers: aggregated.blockers,
      warnings: aggregated.warnings,
      notes: aggregated.notes,
      passCount: aggregated.passCount,
      totalAgents: aggregated.totalAgents,
      evidenceDir,
    })
  } else {
    const summary = `review code: tier=${tier} agents=${aggregated.totalAgents} blockers=${aggregated.blockers.length} warnings=${aggregated.warnings.length} notes=${aggregated.notes.length} pass=${aggregated.passCount}\n`
    process.stdout.write(summary)
    for (const f of aggregated.blockers) {
      process.stdout.write(
        `  [BLOCKER ${f.agent}] ${f.message}${f.location ? ` (${f.location})` : ''}\n`,
      )
    }
    for (const f of aggregated.warnings) {
      process.stdout.write(
        `  [WARN ${f.agent}] ${f.message}${f.location ? ` (${f.location})` : ''}\n`,
      )
    }
    for (const f of aggregated.notes) {
      process.stdout.write(
        `  [NOTE ${f.agent}] ${f.message}${f.location ? ` (${f.location})` : ''}\n`,
      )
    }
    process.stdout.write(`evidence: ${evidenceDir}\n`)
  }

  return { exitCode, aggregated, evidenceDir }
}
