// SPDX-License-Identifier: Apache-2.0
/**
 * Plan-review subagent dispatcher (#235, #695).
 *
 * Builds an XML prompt around a plan file, persists it under
 * `.evidence/review-<ts>/plan-review-prompt.txt`, then dispatches the
 * configured subagent N times per revise cycle where N is derived from
 * the tier (`TIER_PASS_COUNT`). Each pass is persisted under
 * `.arbiter/evidence/plan-review/<sanitized-task-id>/run-<ts>/pass-<N>.json`
 * and a `latest.json` pointer file is updated for the gate
 * (`requirePlanReviewPass`) to consult.
 *
 * Cycle aggregator:
 *   all PASS  → PASS
 *   any FAIL  → FAIL (fail fast, no revise)
 *   otherwise → WARN → revise (up to MAX_REVISE_CYCLES extra cycles)
 *
 * After max revisions, residual WARN becomes a final FAIL with
 * `reason='max revisions exceeded'`.
 *
 * `verdict: ERROR` from the dispatcher (claude CLI missing) yields a
 * final FAIL unless `ARBITER_PLAN_REVIEW_OPTIONAL=1`, in which case it
 * is treated as PASS (SKIPPED) so CI without claude installed passes.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, runCli } from '../utils/run-cli.js'
import type { AgentReport, AgentResult, Finding } from './multi-agent.js'
import { computeSsotDigest, escapeXml } from './ssot.js'
import { TIER_PASS_COUNT, type ReviewTier } from './tier-constants.js'
import { sanitizeTaskId } from '../utils/task-id.js'
import { readTaskId } from '../commands/task-state.js'
import { currentBranch, headSha } from '../evidence/git-checks.js'

export type Verdict = 'PASS' | 'WARN' | 'FAIL'
type RawVerdict = Verdict | 'ERROR'

export interface SubagentResult {
  stdout: string
  exitCode: number
}

export interface SubagentDispatcher {
  run(prompt: string): SubagentResult
}

export interface BuildPromptOptions {
  planContent: string
  dir: string
  tier: ReviewTier
}

export interface DispatchOptions extends BuildPromptOptions {
  /** Optional dispatcher override — tests pass a fake here. */
  dispatcher?: SubagentDispatcher
  /** Task id used for per-task evidence path. Falls back to the active task then `'unknown'`. */
  taskId?: string
}

export interface DispatchResult {
  verdict: Verdict
  exitCode: 0 | 1 | 2
  /** Number of revise cycles run (1..MAX_REVISE_CYCLES+1). */
  attempts: number
  /** Total subagent invocations across all cycles (cycles × passesPerCycle). */
  totalInvocations: number
  promptPath: string
  evidenceDir: string
  runDir: string
  latestPath: string
  /** Set when verdict was synthesised from a meta-condition (max revises, ERROR). */
  reason?: string
}

const MAX_REVISE_CYCLES = 2

/**
 * Re-exported from the leaf utility `src/utils/task-id.ts` so existing importers
 * (and the parity test `__tests__/lib/sanitize-task-id-parity.test.ts`) keep working.
 * The leaf module is the single source shared with `src/commands/task-state.ts` and
 * `.claude/hooks/lib.mjs::sanitizeTaskId`.
 */
export { sanitizeTaskId }

export function buildReviewPrompt(opts: BuildPromptOptions): string {
  const digest = computeSsotDigest(opts.dir)
  const safePlan = escapeXml(opts.planContent)
  const passCount = TIER_PASS_COUNT[opts.tier]
  return [
    `<review version="1">`,
    `  <tier>${opts.tier}</tier>`,
    `  <passCount>${passCount}</passCount>`,
    `  <ssotDigest>${digest}</ssotDigest>`,
    `  <instructions>`,
    `    Evaluate the plan against AGENTS.md invariants and produce a verdict:`,
    `    "verdict: PASS"  — plan is implementable as-is`,
    `    "verdict: WARN"  — plan has fixable gaps; reviser MAY revise once`,
    `    "verdict: FAIL"  — plan violates an invariant or is incoherent`,
    `  </instructions>`,
    `  <plan>`,
    safePlan,
    `  </plan>`,
    `</review>`,
  ].join('\n')
}

function parseRawVerdict(stdout: string): RawVerdict {
  const m = stdout.match(/verdict:\s*(PASS|WARN|FAIL|ERROR)/i)
  if (!m) return 'FAIL'
  return (m[1] ?? 'FAIL').toUpperCase() as RawVerdict
}

/** Default dispatcher: spawns `claude` via runCli (INV-12). */
const DEFAULT_DISPATCHER: SubagentDispatcher = {
  run(prompt: string): SubagentResult {
    try {
      const result = runCli('claude', ['-p', prompt], { timeoutMs: 600_000 })
      return { stdout: result.stdout, exitCode: result.exitCode }
    } catch (err) {
      if (err instanceof CliError && err.notFound) {
        return { stdout: 'verdict: ERROR\n', exitCode: 127 }
      }
      throw err
    }
  },
}

function evidenceDirFor(dir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return join(dir, '.evidence', `review-${ts}`)
}

function persistPrompt(dir: string, prompt: string): string {
  const reviewDir = evidenceDirFor(dir)
  mkdirSync(reviewDir, { recursive: true })
  const path = join(reviewDir, 'plan-review-prompt.txt')
  writeFileSync(path, prompt, 'utf-8')
  return path
}

function verdictToExitCode(verdict: Verdict): 0 | 1 | 2 {
  if (verdict === 'PASS') return 0
  if (verdict === 'WARN') return 1
  return 2
}

/**
 * Resolve the sanitised task id for a per-task evidence path: prefer the
 * explicit `taskId`, else the active task on disk, else `'unknown'`. Shared by
 * both the dispatch and submit paths.
 */
function resolveTaskId(opts: { taskId?: string; dir: string }): string {
  if (opts.taskId !== undefined && opts.taskId.length > 0) return sanitizeTaskId(opts.taskId)
  const id = readTaskId(opts.dir)
  return id !== undefined ? sanitizeTaskId(id) : 'unknown'
}

function planReviewEvidenceDir(dir: string, sanitisedTaskId: string): string {
  return join(dir, '.arbiter', 'evidence', 'plan-review', sanitisedTaskId)
}

/**
 * Resolve the per-task evidence dir and create a fresh timestamped run dir under
 * it. Shared by the dispatch and submit paths so both write into the identical
 * `<task>/run-<ts>/` layout the gate consumes (CANON-22: one site, no clone).
 */
function makeRunDir(opts: { taskId?: string; dir: string }): {
  evidenceDir: string
  runDir: string
} {
  const evidenceDir = planReviewEvidenceDir(opts.dir, resolveTaskId(opts))
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = join(evidenceDir, `run-${ts}`)
  mkdirSync(runDir, { recursive: true })
  return { evidenceDir, runDir }
}

/**
 * Shape of the per-task `latest.json` pointer the plan-review gate
 * (`requirePlanReviewPass`) consults. Both the claude-dispatch path
 * (`dispatchPlanReview`) and the agent-agnostic submit path
 * (`submitPlanReview`, #1329) write this via {@link writeLatest} so the
 * evidence is byte-compatible regardless of who produced the verdict.
 */
interface LatestRecord {
  verdict: Verdict
  runDir: string
  planDigest: string
  branch: string
  sha: string
  tier: ReviewTier
  totalInvocations: number
  attempts: number
  /** Provenance: reviewer identity (set by the submit path). */
  reviewer?: string
  /** Provenance: 'dispatch' (claude CLI) or 'submit' (agent-agnostic, #1329). */
  source?: 'dispatch' | 'submit'
  reason?: string
}

/**
 * Single writer for `<evidenceDir>/latest.json`. Keeping one writer is the
 * CANON-22 root-cause guard against the two review paths drifting their
 * evidence format apart (asserted by the key-parity test).
 */
function writeLatest(evidenceDir: string, rec: LatestRecord): string {
  const latestPath = join(evidenceDir, 'latest.json')
  const latest = {
    verdict: rec.verdict,
    ts: new Date().toISOString(),
    runDir: rec.runDir,
    planDigest: rec.planDigest,
    // #1212: branch+sha stamp so the fail-closed Stop hook can correlate this
    // plan-review evidence to the current branch (and confirm the sha is an
    // ancestor of HEAD) before allowing a completion claim.
    branch: rec.branch,
    sha: rec.sha,
    tier: rec.tier,
    totalInvocations: rec.totalInvocations,
    attempts: rec.attempts,
    ...(rec.reviewer !== undefined ? { reviewer: rec.reviewer } : {}),
    ...(rec.source !== undefined ? { source: rec.source } : {}),
    ...(rec.reason !== undefined ? { reason: rec.reason } : {}),
  }
  writeFileSync(latestPath, JSON.stringify(latest, null, 2), 'utf-8')
  return latestPath
}

function aggregateCycle(verdicts: readonly RawVerdict[]): RawVerdict {
  if (verdicts.some((v) => v === 'ERROR')) return 'ERROR'
  if (verdicts.some((v) => v === 'FAIL')) return 'FAIL'
  if (verdicts.every((v) => v === 'PASS')) return 'PASS'
  return 'WARN'
}

interface CycleOutcome {
  cycleVerdict: RawVerdict
  passVerdicts: RawVerdict[]
}

function runCycle(
  dispatcher: SubagentDispatcher,
  prompt: string,
  passCount: number,
  runDir: string,
  cycleIdx: number,
): CycleOutcome {
  const passVerdicts: RawVerdict[] = []
  for (let p = 1; p <= passCount; p++) {
    const r = dispatcher.run(prompt)
    const v = parseRawVerdict(r.stdout)
    passVerdicts.push(v)
    const file = join(runDir, `pass-${cycleIdx * passCount + p}.json`)
    writeFileSync(
      file,
      JSON.stringify(
        {
          pass: cycleIdx * passCount + p,
          cycle: cycleIdx + 1,
          verdict: v,
          stdout: r.stdout,
          ts: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    )
  }
  return { cycleVerdict: aggregateCycle(passVerdicts), passVerdicts }
}

interface FinaliseOutcome {
  verdict: Verdict
  reason?: string
}

function finaliseVerdict(raw: RawVerdict, attempts: number): FinaliseOutcome {
  if (raw === 'PASS') return { verdict: 'PASS' }
  if (raw === 'FAIL') return { verdict: 'FAIL' }
  if (raw === 'ERROR') {
    if (process.env.ARBITER_PLAN_REVIEW_OPTIONAL === '1') return { verdict: 'PASS' }
    return {
      verdict: 'FAIL',
      reason: 'claude CLI required for plan-review; install or set --skip-plan-review',
    }
  }
  // WARN exhausted revisions
  if (attempts > MAX_REVISE_CYCLES) {
    return { verdict: 'FAIL', reason: 'max revisions exceeded' }
  }
  return { verdict: 'WARN' }
}

export function dispatchPlanReview(opts: DispatchOptions): DispatchResult {
  const prompt = buildReviewPrompt(opts)
  const promptPath = persistPrompt(opts.dir, prompt)
  const dispatcher = opts.dispatcher ?? DEFAULT_DISPATCHER
  const passCount = TIER_PASS_COUNT[opts.tier]
  const { evidenceDir, runDir } = makeRunDir(opts)

  let attempts = 0
  let lastRaw: RawVerdict = 'FAIL'
  let totalInvocations = 0
  let cycleError: string | undefined
  for (let cycle = 0; cycle <= MAX_REVISE_CYCLES; cycle++) {
    attempts++
    let outcome: CycleOutcome
    try {
      outcome = runCycle(dispatcher, prompt, passCount, runDir, cycle)
    } catch (err) {
      cycleError = err instanceof Error ? err.message : String(err)
      lastRaw = 'ERROR'
      break
    }
    totalInvocations += outcome.passVerdicts.length
    lastRaw = outcome.cycleVerdict
    if (lastRaw === 'PASS' || lastRaw === 'FAIL' || lastRaw === 'ERROR') break
    // WARN — revise
  }

  const final = finaliseVerdict(lastRaw, attempts)
  const resolvedReason = cycleError !== undefined ? cycleError : final.reason
  const planDigest = createHash('sha256').update(opts.planContent).digest('hex')
  const latestPath = writeLatest(evidenceDir, {
    verdict: final.verdict,
    runDir,
    planDigest,
    branch: currentBranch(opts.dir),
    sha: headSha(opts.dir),
    tier: opts.tier,
    totalInvocations,
    attempts,
    source: 'dispatch',
    ...(resolvedReason !== undefined ? { reason: resolvedReason } : {}),
  })

  return {
    verdict: final.verdict,
    exitCode: verdictToExitCode(final.verdict),
    attempts,
    totalInvocations,
    promptPath,
    evidenceDir,
    runDir,
    latestPath,
    ...(resolvedReason !== undefined ? { reason: resolvedReason } : {}),
  }
}

/* ─────────────────  agent-agnostic plan review (#1329)  ───────────────── */

/**
 * Manifest written alongside the emitted prompt files. Lets `submitPlanReview`
 * (and a human operator) know how many pass verdicts are expected and detect a
 * plan edit between emit and submit (planDigest cross-check).
 */
export interface EmitManifest {
  taskId: string
  tier: ReviewTier
  passCount: number
  planDigest: string
  ssotDigest: string
  /** Filename pattern of the emitted prompt files, e.g. `pass-<N>.txt`. */
  promptPattern: string
}

export interface EmitPromptsOptions extends BuildPromptOptions {
  /** Directory the per-pass prompt files + manifest.json are written to. */
  emitDir: string
  taskId?: string
}

export interface EmitPromptsResult {
  emitDir: string
  passCount: number
  promptPaths: string[]
  manifestPath: string
}

/**
 * Write the per-pass plan-review prompt files + a manifest to `emitDir`, then
 * return without dispatching `claude` (#1329). The orchestrating agent (a hosted
 * agent session, Codex, any model) reads these prompts, performs the review itself, and feeds
 * its verdicts back through {@link submitPlanReview}. No `latest.json` is written
 * here — the review has not happened yet.
 */
export function emitPlanReviewPrompts(opts: EmitPromptsOptions): EmitPromptsResult {
  const prompt = buildReviewPrompt(opts)
  const passCount = TIER_PASS_COUNT[opts.tier]
  const taskId =
    opts.taskId !== undefined && opts.taskId.length > 0 ? sanitizeTaskId(opts.taskId) : 'unknown'
  mkdirSync(opts.emitDir, { recursive: true })
  const promptPaths: string[] = []
  // Each pass is an independent review of the same prompt (mirrors runCycle).
  for (let p = 1; p <= passCount; p++) {
    const file = join(opts.emitDir, `pass-${p}.txt`)
    writeFileSync(file, prompt, 'utf-8')
    promptPaths.push(file)
  }
  const manifest: EmitManifest = {
    taskId,
    tier: opts.tier,
    passCount,
    planDigest: createHash('sha256').update(opts.planContent).digest('hex'),
    ssotDigest: computeSsotDigest(opts.dir),
    promptPattern: 'pass-<N>.txt',
  }
  const manifestPath = join(opts.emitDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  return { emitDir: opts.emitDir, passCount, promptPaths, manifestPath }
}

export interface SubmittedPass {
  pass: number
  verdict: Verdict
  notes?: string
}

export interface SubmitOptions {
  dir: string
  tier: ReviewTier
  /** Raw plan content — recomputes the planDigest the gate's digest check needs. */
  planContent: string
  /** One verdict per expected pass (1..TIER_PASS_COUNT[tier]). */
  passes: readonly SubmittedPass[]
  /** Provenance: identity of the agent/human that produced the verdicts. */
  reviewer: string
  taskId?: string
  /** Optional emit manifest path to cross-check the plan has not changed. */
  manifestPath?: string
}

export interface SubmitResult {
  verdict: Verdict
  exitCode: 0 | 1 | 2
  evidenceDir: string
  runDir: string
  latestPath: string
  reason?: string
}

/** Thrown for malformed `review submit` input (mapped to exit 2 by the caller). */
export class SubmitValidationError extends Error {}

const VALID_VERDICTS: readonly Verdict[] = ['PASS', 'WARN', 'FAIL']

/** Runtime verdict-token guard for the public `submitPlanReview` boundary. */
export function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'string' && (VALID_VERDICTS as readonly string[]).includes(v)
}

function validateSubmittedPasses(passes: readonly SubmittedPass[], passCount: number): void {
  if (passes.length !== passCount) {
    throw new SubmitValidationError(
      `expected ${passCount} pass verdict(s) for this tier, got ${passes.length}`,
    )
  }
  const seen = new Set<number>()
  for (const p of passes) {
    if (!Number.isInteger(p.pass) || p.pass < 1 || p.pass > passCount) {
      throw new SubmitValidationError(`pass index ${p.pass} out of range 1..${passCount}`)
    }
    if (seen.has(p.pass)) {
      throw new SubmitValidationError(`duplicate verdict for pass ${p.pass}`)
    }
    seen.add(p.pass)
    // Defense-in-depth: the CLI (parsePassSpecs) already gates verdict tokens,
    // but a programmatic caller could `as`-cast a bogus token that would
    // otherwise fold to WARN in aggregateCycle. Guard at the runtime boundary.
    if (!isVerdict(p.verdict)) {
      throw new SubmitValidationError(`invalid verdict "${String(p.verdict)}" for pass ${p.pass}`)
    }
  }
}

function crossCheckManifest(
  manifestPath: string,
  planDigest: string,
  tier: ReviewTier,
  ssotDigest: string,
): void {
  if (!existsSync(manifestPath)) {
    throw new SubmitValidationError(`emit manifest not found: ${manifestPath}`)
  }
  let manifest: EmitManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as EmitManifest
  } catch (err) {
    throw new SubmitValidationError(
      `unreadable manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (manifest.planDigest !== planDigest) {
    throw new SubmitValidationError(
      'plan changed since prompts were emitted — re-run --emit-prompts',
    )
  }
  if (manifest.tier !== tier) {
    throw new SubmitValidationError(
      `manifest tier ${manifest.tier} != submit tier ${tier} — re-run --emit-prompts for this tier`,
    )
  }
  // RT-#1329 MEDIUM: enforce the SSOT-drift guard the manifest advertises. If the
  // governance SSOT changed between emit and submit, the emitted prompts are stale.
  if (manifest.ssotDigest !== ssotDigest) {
    throw new SubmitValidationError(
      'governance SSOT changed since prompts were emitted — re-run --emit-prompts',
    )
  }
}

/**
 * Record agent-produced pass verdicts into the same evidence layout the claude
 * dispatch path writes (#1329). The gate (`requirePlanReviewPass`) finalises
 * unchanged because {@link writeLatest} produces a byte-compatible `latest.json`.
 * Throws {@link SubmitValidationError} on malformed input (NO evidence written).
 */
export function submitPlanReview(opts: SubmitOptions): SubmitResult {
  const passCount = TIER_PASS_COUNT[opts.tier]
  validateSubmittedPasses(opts.passes, passCount)
  const planDigest = createHash('sha256').update(opts.planContent).digest('hex')
  if (opts.manifestPath !== undefined) {
    crossCheckManifest(opts.manifestPath, planDigest, opts.tier, computeSsotDigest(opts.dir))
  }

  const { evidenceDir, runDir } = makeRunDir(opts)

  const ordered = [...opts.passes].sort((a, b) => a.pass - b.pass)
  for (const p of ordered) {
    writeFileSync(
      join(runDir, `pass-${p.pass}.json`),
      JSON.stringify(
        {
          pass: p.pass,
          cycle: 1,
          verdict: p.verdict,
          reviewer: opts.reviewer,
          source: 'submit',
          ...(p.notes !== undefined ? { notes: p.notes } : {}),
          ts: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    )
  }

  const cycleVerdict = aggregateCycle(ordered.map((p) => p.verdict))
  const final = finaliseVerdict(cycleVerdict, 1)
  const latestPath = writeLatest(evidenceDir, {
    verdict: final.verdict,
    runDir,
    planDigest,
    branch: currentBranch(opts.dir),
    sha: headSha(opts.dir),
    tier: opts.tier,
    totalInvocations: passCount,
    attempts: 1,
    reviewer: opts.reviewer,
    source: 'submit',
    ...(final.reason !== undefined ? { reason: final.reason } : {}),
  })

  return {
    verdict: final.verdict,
    exitCode: verdictToExitCode(final.verdict),
    evidenceDir,
    runDir,
    latestPath,
    ...(final.reason !== undefined ? { reason: final.reason } : {}),
  }
}

/* ───────────────────────  multi-agent code review (#236)  ─────────────────────── */

export interface DispatchClaudeAgentOptions {
  /** Optional override of the claude binary command — defaults to "claude". */
  cmd?: string
  /** Timeout per agent invocation in milliseconds. */
  timeoutMs?: number
  /** If set, the raw agent response is written to `<evidenceDir>/agent-<name>.json`. */
  evidenceDir?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFinding(v: unknown): v is Finding {
  if (!isRecord(v)) return false
  const sev = v['severity']
  if (sev !== 'blocker' && sev !== 'warning' && sev !== 'note') return false
  if (typeof v['agent'] !== 'string') return false
  if (typeof v['message'] !== 'string') return false
  return true
}

/**
 * Extract the first balanced `{...}` block from `s`.
 *
 * Walks the string tracking brace depth, ignoring braces inside JSON
 * string literals (handles escaped quotes). Returns the substring or
 * null when no balanced block is found.
 */
export function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

export function parseAgentReport(stdout: string, agent: string): AgentReport {
  const trimmed = stdout.trim()
  const payload = extractFirstJsonObject(trimmed) ?? trimmed
  const parsed: unknown = JSON.parse(payload)
  if (!isRecord(parsed)) {
    throw new Error(`agent "${agent}" returned non-object payload`)
  }
  const findingsRaw = parsed['findings']
  if (!Array.isArray(findingsRaw)) {
    throw new Error(`agent "${agent}" missing "findings" array`)
  }
  const findings: Finding[] = []
  for (const f of findingsRaw) {
    if (!isFinding(f)) {
      throw new Error(`agent "${agent}" produced a malformed finding`)
    }
    findings.push(f)
  }
  const passed = parsed['passed'] === true
  return { findings, passed }
}

export function dispatchClaudeAgent(
  opts: DispatchClaudeAgentOptions = {},
): (prompt: string, agentName: string) => Promise<AgentResult> {
  const cmd = opts.cmd ?? 'claude'
  const timeoutMs = opts.timeoutMs ?? 600_000
  const evidenceDir = opts.evidenceDir

  return (prompt: string, agentName: string): Promise<AgentResult> => {
    let rawStdout = ''
    try {
      const result = runCli(cmd, ['-p', prompt], { timeoutMs })
      rawStdout = result.stdout
      const report = parseAgentReport(rawStdout, agentName)
      const agentResult: AgentResult = {
        agent: agentName,
        findings: report.findings,
        passed: report.passed,
        rawStdout,
        prompt,
      }
      if (evidenceDir !== undefined) {
        persistAgentResponse(evidenceDir, agentName, agentResult)
      }
      return Promise.resolve(agentResult)
    } catch (err) {
      const isTimeout = err instanceof CliError && err.timedOut
      const message = err instanceof Error ? err.message : String(err)
      const reason = isTimeout
        ? `agent "${agentName}" timed out after ${timeoutMs}ms`
        : `agent "${agentName}" failed: ${message}`
      const failResult: AgentResult = {
        agent: agentName,
        findings: [
          {
            severity: 'blocker',
            agent: agentName,
            message: reason,
          },
        ],
        passed: false,
        rawStdout,
        prompt,
      }
      if (evidenceDir !== undefined) {
        persistAgentResponse(evidenceDir, agentName, failResult)
      }
      return Promise.resolve(failResult)
    }
  }
}

function persistAgentResponse(evidenceDir: string, agentName: string, result: AgentResult): void {
  mkdirSync(evidenceDir, { recursive: true })
  const path = join(evidenceDir, `agent-${agentName}.json`)
  writeFileSync(
    path,
    JSON.stringify(
      {
        agent: result.agent,
        passed: result.passed,
        findings: result.findings,
        rawStdout: result.rawStdout,
      },
      null,
      2,
    ),
    'utf-8',
  )
}

/** Build a fresh evidence dir for a multi-agent code-review run. */
export function makeCodeReviewEvidenceDir(dir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(dir, '.evidence', `review-${ts}`)
  mkdirSync(path, { recursive: true })
  return path
}
