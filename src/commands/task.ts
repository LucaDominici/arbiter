// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeTaskId } from '../review/dispatch.js'
import {
  type TaskPhase,
  type UnifiedTaskState,
  type TaskStatePatch,
  PHASE_ORDER,
  LATERAL_PHASES,
  isValidPhase,
  readUnifiedState,
  writeUnifiedState,
  readTaskId,
  appendLog,
} from './task-state.js'
import { runCli, type RunCliResult } from '../utils/run-cli.js'
import { loadTddEvidence, extractFailureSignature } from '../evidence/tdd.js'
import { shaExistsOnBranch, pathExistsInCommit } from '../evidence/git-checks.js'
import { detectHostCapabilities } from '../capabilities/host-probe.js'
import { assertImplBudget } from '../cost/budget.js'
import { recordPhaseCost } from '../cost/recorder.js'
import { readTranscriptCosts } from '../cost/transcript-reader.js'

export class HandoffRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HandoffRequiredError'
  }
}

export class BudgetBreachError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetBreachError'
  }
}

// Task-state vocabulary and the unified-document I/O live in `./task-state.ts`.
// Re-export the phase types here so existing importers (e.g. src/cli.ts) keep their import path.
export type { TaskPhase } from './task-state.js'
export { runTaskMark } from './task-mark.js'

export interface TaskAdvanceOptions {
  to: TaskPhase
  dir?: string
  reverse?: boolean
  /** Bypass the plan-review gate when target is red. Writes an audit record. */
  skipPlanReview?: boolean
  /** Signal that this invocation is post-/clear (equivalent to ARBITER_POST_CLEAR=1). */
  postClear?: boolean
  /** Skip the budget assertion on post-clear re-entry (writes warning). */
  skipBudget?: boolean
  /** Caller-supplied implementation unit count; drives the clear-strategy decision.
   *  When absent, falls back to the tier's conservative default (→ 'stop'). */
  units?: number
}

/** Current phase from the unified document (`preflight` for a fresh tree). */
function currentPhase(root: string): TaskPhase {
  return readUnifiedState(root)?.phase ?? 'preflight'
}

export interface TaskResumeOptions {
  dir?: string
}

const RECOVERY_TABLE: Record<TaskPhase, string> = {
  preflight:
    'Phase: preflight\nAction: Run /task #NNN to initialize the task branch and plan.\nCommand: node scripts/check-all.mjs L1',
  plan: 'Phase: plan\nAction: Plan is being written. Review .claude/plans/ for existing plan draft.\nNext: Await user GO before editing files.',
  'red-team-review':
    'Phase: red-team-review\nAction: Red-team agents running. Review .arbiter/evidence/redteam/<task-id>.json.\nNext: CRITICAL findings → arbiter task advance --to red-team-rework. All clear → arbiter task advance --to red.',
  'red-team-rework':
    'Phase: red-team-rework\nAction: Critical findings require plan revision. Fix plan, then re-run red-team.\nNext: arbiter task advance --to red-team-review (re-triggers review) or --to plan (full replan).',
  red: 'Phase: red\nAction: Write failing tests first. No implementation yet.\nNext: Tests written → arbiter task advance --to green.',
  green:
    'Phase: green\nAction: Make tests pass with minimal implementation.\nNext: All tests green → arbiter task advance --to refactor.',
  refactor:
    'Phase: refactor\nAction: Clean up implementation. Tests must stay green.\nNext: Refactor done → arbiter task advance --to verification.',
  verification:
    'Phase: verification\nAction: Gate running. Re-run: node scripts/check-all.mjs L2\nNext: Fix any failures, then commit and push.',
  complete:
    'Phase: complete\nAction: Task is complete. Check if PR was created: gh pr list --head $(git branch --show-current)\nNext: Verify PR merged and issue closed.',
}

export function runTaskResume({ dir }: TaskResumeOptions = {}): void {
  const root = dir ?? process.cwd()
  const state = readUnifiedState(root)
  const phase = state?.phase ?? 'preflight'
  const taskId = state?.taskId && state.taskId.length > 0 ? state.taskId : undefined
  const header = taskId ? `Task: ${taskId}\n` : ''

  // Pinpoint resume (#1206): if a step-cursor was marked, land on the EXACT next action
  // rather than the coarse, phase-level RECOVERY_TABLE blurb.
  const cursor = state?.cursor
  if (cursor && cursor.nextAction.trim().length > 0) {
    const lines = [
      `${header}Phase: ${phase}${cursor.tddPhase ? ` (${cursor.tddPhase})` : ''}`,
      cursor.lastAction.trim().length > 0 ? `Last action: ${cursor.lastAction}` : undefined,
      `Next action: ${cursor.nextAction}`,
    ].filter((l): l is string => l !== undefined)
    process.stdout.write(lines.join('\n') + '\n')
    return
  }

  process.stdout.write(`${header}${RECOVERY_TABLE[phase]}\n`)
}

/* ────────────────────────  #1206 — shell-facing state I/O  ──────────────────────── */

export interface TaskInitOptions {
  dir?: string
  id?: string
  tier?: string
  plan?: string
}

/**
 * Initialise / update the unified task document from the slash-command shell layer (replaces the
 * historical per-task dotfile writes). Never advances the phase.
 */
export function runTaskInit(opts: TaskInitOptions = {}): void {
  const root = opts.dir ?? process.cwd()
  const patch: TaskStatePatch = {}
  if (opts.id !== undefined) patch.taskId = opts.id
  if (opts.tier !== undefined) patch.tier = opts.tier
  if (opts.plan !== undefined) patch.plan = opts.plan
  const branch = detectCurrentBranch(root)
  if (branch !== undefined) patch.branch = branch
  const state = writeUnifiedState(root, patch)
  appendLog(root, `init task ${state.taskId || '(unset)'} tier=${state.tier || '(unset)'}`)
}

/** Current git branch name, or undefined if not a repo / detached. */
function detectCurrentBranch(root: string): string | undefined {
  try {
    const r = runCli('git', ['branch', '--show-current'], { cwd: root, timeoutMs: 5000 })
    const name = r.stdout.trim()
    return name.length > 0 ? name : undefined
  } catch {
    return undefined
  }
}

const GETTABLE_FIELDS = ['phase', 'taskId', 'tier', 'plan', 'tddPhase', 'lastAction', 'nextAction']

export interface TaskGetOptions {
  dir?: string
  field: string
}

/**
 * Print a single task-state field to stdout for shell consumers (replaces `cat .claude/.task-*`).
 * Exit 2 on an unknown field name.
 */
export function runTaskGet(opts: TaskGetOptions): void {
  const root = opts.dir ?? process.cwd()
  const s = readUnifiedState(root)
  const values: Record<string, string> = s
    ? {
        phase: s.phase,
        taskId: s.taskId,
        tier: s.tier,
        plan: s.plan,
        tddPhase: s.cursor.tddPhase ?? '',
        lastAction: s.cursor.lastAction,
        nextAction: s.cursor.nextAction,
      }
    : Object.fromEntries(GETTABLE_FIELDS.map((f) => [f, f === 'phase' ? 'preflight' : '']))
  const value = values[opts.field]
  if (value === undefined) {
    process.stderr.write(`Unknown field "${opts.field}". Valid: ${GETTABLE_FIELDS.join(', ')}\n`)
    process.exit(2)
  }
  process.stdout.write(`${value}\n`)
}

/* ────────────────────────  #694 — backlog + recover  ──────────────────────── */

export type Runner = (cmd: string, args: readonly string[]) => RunCliResult

const defaultRunner: Runner = (cmd, args) => runCli(cmd, args, { timeoutMs: 30_000 })

function planReviewDir(dir: string, sanitisedId: string): string {
  return join(dir, '.arbiter', 'evidence', 'plan-review', sanitisedId)
}

function backlogPath(dir: string, sanitisedId: string): string {
  return join(dir, '.arbiter', 'evidence', sanitisedId, 'BACKLOG.md')
}

export interface TaskRecoverOptions {
  dir?: string
  taskId?: string
  runner?: Runner
}

function readTaskIdFromDisk(dir: string): string | undefined {
  return readTaskId(dir)
}

/**
 * Print 3-layer recovery context (#694).
 *
 * Layer 1: contents of `.arbiter/evidence/<sanitized-id>/BACKLOG.md` if present.
 * Layer 2: recent `CHECKPOINT(#<sanitized-id>)` commits via `git log --grep`.
 * Layer 3: last 20 commits via plain `git log` (fallback context).
 *
 * Always emits a footer with the manual MCP fallback instruction.
 */
export function runTaskRecover(opts: TaskRecoverOptions = {}): void {
  const dir = opts.dir ?? process.cwd()
  const rawId =
    opts.taskId !== undefined && opts.taskId.length > 0 ? opts.taskId : readTaskIdFromDisk(dir)
  if (rawId === undefined) {
    process.stdout.write(
      'No task id provided and no active task found. Pass --task <id> to recover.\n',
    )
    return
  }
  const sanit = sanitizeTaskId(rawId)
  const runner = opts.runner ?? defaultRunner

  const parts: string[] = []
  parts.push(`━━━ Recovery for task ${rawId} (sanitized: ${sanit}) ━━━\n`)

  const backlog = backlogPath(dir, sanit)
  if (existsSync(backlog)) {
    parts.push('━━━ Layer 1: BACKLOG.md ━━━')
    parts.push(readFileSync(backlog, 'utf-8'))
    parts.push('━━━ END Layer 1 ━━━\n')
  } else {
    parts.push(`Layer 1: no BACKLOG.md at ${backlog}\n`)
  }

  parts.push(`━━━ Layer 2: CHECKPOINT(#${sanit}) commits ━━━`)
  try {
    // -F treats --grep value as a literal string (no regex metachars), defence
    // in depth on top of sanitizeTaskId — see #694 red-team CRITICAL #2.
    const r = runner('git', [
      'log',
      '-F',
      '--grep',
      `CHECKPOINT(#${sanit})`,
      '--max-count=10',
      '--format=%h %s %ad',
      '--date=iso',
    ])
    parts.push(r.stdout.trim() || '(no matching CHECKPOINT commits)')
  } catch (err) {
    parts.push(`(git log failed: ${err instanceof Error ? err.message : String(err)})`)
  }
  parts.push('━━━ END Layer 2 ━━━\n')

  parts.push('━━━ Layer 3: last 20 commits ━━━')
  try {
    const r = runner('git', ['log', '--max-count=20', '--format=%h %s %ad', '--date=iso'])
    parts.push(r.stdout.trim() || '(no commits)')
  } catch (err) {
    parts.push(`(git log failed: ${err instanceof Error ? err.message : String(err)})`)
  }
  parts.push('━━━ END Layer 3 ━━━\n')

  parts.push(
    'If still unclear, run /clear and reopen with manual MCP context — feed the issue body, the plan file, and the last few commits to the next session.',
  )

  process.stdout.write(parts.join('\n') + '\n')
}

/* ─────────────────────  #695 — plan-review gate  ───────────────────── */

interface RequirePlanReviewPassOptions {
  dir: string
  taskId: string
  planContent?: string
}

interface RequirePlanReviewPassResult {
  ok: boolean
  reason?: string
}

interface LatestJson {
  verdict: string
  planDigest?: string
}

/**
 * Check `<dir>/.arbiter/evidence/plan-review/<sanitized-id>/latest.json`
 * for a PASS verdict matching the supplied plan content (digest check).
 */
function requirePlanReviewPass(opts: RequirePlanReviewPassOptions): RequirePlanReviewPassResult {
  const sanit = sanitizeTaskId(opts.taskId)
  const latestPath = join(planReviewDir(opts.dir, sanit), 'latest.json')
  if (!existsSync(latestPath)) {
    return {
      ok: false,
      reason: `no plan-review evidence at ${latestPath} — run \`arbiter review plan\` first`,
    }
  }
  let parsed: LatestJson
  try {
    parsed = JSON.parse(readFileSync(latestPath, 'utf-8')) as LatestJson
  } catch (err) {
    return {
      ok: false,
      reason: `unreadable latest.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (parsed.verdict !== 'PASS') {
    return { ok: false, reason: `last plan-review verdict was ${parsed.verdict}` }
  }
  if (opts.planContent !== undefined && parsed.planDigest !== undefined) {
    const got = createHash('sha256').update(opts.planContent).digest('hex')
    if (got !== parsed.planDigest) {
      return {
        ok: false,
        reason: 'plan changed since last review — re-run `arbiter review plan`',
      }
    }
  }
  return { ok: true }
}

function gateEnabled(dir: string): boolean {
  return existsSync(join(dir, '.arbiter', 'plan-review.enabled'))
}

function readGitUserName(): string {
  try {
    const r = runCli('git', ['config', 'user.name'], { timeoutMs: 5000 })
    return r.stdout.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function writeBypassRecord(dir: string, sanitisedId: string, reason: 'flag' | 'env'): void {
  const evDir = planReviewDir(dir, sanitisedId)
  mkdirSync(evDir, { recursive: true })
  const ts = new Date().toISOString()
  const record = {
    reason,
    git_user: readGitUserName(),
    ts,
  }
  writeFileSync(
    join(evDir, `bypass-${ts.replace(/[:.]/g, '-')}.json`),
    JSON.stringify(record, null, 2),
    'utf-8',
  )
}

function loadPlanContentIfAvailable(dir: string): string | undefined {
  const planPath = readUnifiedState(dir)?.plan.trim()
  if (!planPath || planPath.length === 0) return undefined
  const resolved = join(dir, planPath)
  const candidate = existsSync(planPath) ? planPath : existsSync(resolved) ? resolved : undefined
  if (candidate === undefined) return undefined
  return readFileSync(candidate, 'utf-8')
}

function checkPlanReviewGate(dir: string, claudeDir: string, opts: TaskAdvanceOptions): void {
  if (!gateEnabled(dir)) return
  const rawId = readTaskIdFromDisk(dir) ?? 'unknown'
  const sanit = sanitizeTaskId(rawId)
  const inCi = process.env.CI === 'true'
  const envBypass = process.env.ARBITER_SKIP_PLAN_REVIEW === '1'

  if (opts.skipPlanReview === true) {
    writeBypassRecord(dir, sanit, 'flag')
    process.stderr.write('WARNING: plan-review gate bypassed (reason=flag, --skip-plan-review)\n')
    return
  }
  if (envBypass && !inCi) {
    writeBypassRecord(dir, sanit, 'env')
    process.stderr.write(
      'WARNING: plan-review gate bypassed (reason=env, ARBITER_SKIP_PLAN_REVIEW=1)\n',
    )
    return
  }

  const planContent = loadPlanContentIfAvailable(dir)
  const result = requirePlanReviewPass({
    dir,
    taskId: rawId,
    ...(planContent !== undefined ? { planContent } : {}),
  })
  if (!result.ok) {
    const hint = inCi
      ? `--skip-plan-review (env ARBITER_SKIP_PLAN_REVIEW is refused under CI)`
      : `--skip-plan-review (or env ARBITER_SKIP_PLAN_REVIEW=1)`
    throw new Error(
      `plan-review gate: ${result.reason}. Use ${hint} to bypass with an audit record.`,
    )
  }
  void claudeDir
}

export function runTaskAdvance(opts: TaskAdvanceOptions): void {
  const dir = opts.dir ?? process.cwd()
  const claudeDir = join(dir, '.claude')
  const { to } = opts

  if (!isValidPhase(to)) {
    throw new Error(
      `Invalid --to value: "${String(to)}". Valid phases: ${[...PHASE_ORDER, ...LATERAL_PHASES].join(', ')}`,
    )
  }

  const current = currentPhase(dir)

  if (current === to) return

  const isLateralTarget = (LATERAL_PHASES as readonly string[]).includes(to)
  const isLateralCurrent = (LATERAL_PHASES as readonly string[]).includes(current)

  if (!isLateralTarget && !isLateralCurrent) {
    const currentIdx = PHASE_ORDER.indexOf(current)
    const targetIdx = PHASE_ORDER.indexOf(to)

    if (targetIdx < currentIdx && !opts.reverse) {
      throw new Error(
        `Backward transition "${current}" → "${to}" blocked. Use --reverse to allow backward transitions.`,
      )
    }

    if (targetIdx > currentIdx + 1) {
      throw new Error(
        `Illegal skip: cannot advance from "${current}" to "${to}" (missing intermediate phases). Advance one phase at a time.`,
      )
    }
  }

  const PLANNING_PHASES: ReadonlySet<TaskPhase> = new Set(['red-team-review', 'red-team-rework'])
  const phaseGates: Partial<Record<TaskPhase, () => void>> = {
    red: () => {
      checkPlanReviewGate(dir, claudeDir, opts)
      if (PLANNING_PHASES.has(current)) {
        checkHandoffGate(dir, claudeDir, opts)
      }
    },
    green: () => {
      checkTddEvidenceGate(dir, claudeDir)
    },
  }
  phaseGates[to]?.()

  // Single authoritative write: phase advances in the unified document; the transition is
  // recorded in the append-only log. Gates that throw (handoff) run BEFORE this and never
  // mutate the phase — see checkHandoffGate (C1, #1206).
  writeUnifiedState(dir, { phase: to })
  appendLog(dir, `${current} → ${to}`)
}

function checkTddEvidenceGate(dir: string, claudeDir: string): void {
  const rawId = readTaskIdFromDisk(dir) ?? 'unknown'

  const result = loadTddEvidence(rawId, dir)
  if (!result.ok) {
    throw new Error(
      `TDD evidence gate: ${result.reason}. ` +
        `Run \`arbiter task record-red --test-path <path>\` to capture failing test evidence first.`,
    )
  }

  const ev = result.data
  if (ev.task_id !== rawId) {
    throw new Error(
      `TDD evidence task_id mismatch: evidence has "${ev.task_id}" but active task is "${rawId}".`,
    )
  }

  if (extractFailureSignature(ev.test_run_log) === null) {
    throw new Error(
      `TDD evidence gate: no recognised failure signature found in test_run_log. ` +
        `The test must actually fail before recording evidence.`,
    )
  }

  if (!shaExistsOnBranch(ev.test_commit_sha, dir)) {
    throw new Error(
      `TDD evidence gate: test_commit_sha "${ev.test_commit_sha}" not found in git history. ` +
        `Ensure the test was committed before running \`arbiter task record-red\`.`,
    )
  }

  if (!pathExistsInCommit(ev.test_commit_sha, ev.test_path, dir)) {
    throw new Error(
      `TDD evidence gate: test_path "${ev.test_path}" not found in commit ${ev.test_commit_sha}. ` +
        `Verify the test file was committed at that sha.`,
    )
  }

  void claudeDir
}

function runBudgetCheck(rawId: string, dir: string, opts: TaskAdvanceOptions): void {
  const skipBudget = opts.skipBudget === true || process.env['ARBITER_COST_BUDGET_SKIP'] === '1'
  if (skipBudget) return
  const costEvidencePath = join(dir, '.arbiter', 'evidence', 'cost', `${rawId}.json`)
  try {
    const report = JSON.parse(readFileSync(costEvidencePath, 'utf-8')) as Parameters<
      typeof assertImplBudget
    >[0]
    const budgetResult = assertImplBudget(report)
    if (!budgetResult.ok) {
      throw new BudgetBreachError(
        budgetResult.reason ??
          'Budget assertion failed. Use ARBITER_COST_BUDGET_SKIP=1 to override.',
      )
    }
    if (budgetResult.reason) {
      process.stderr.write(`[arbiter] ${budgetResult.reason}\n`)
    }
  } catch (err) {
    if (err instanceof BudgetBreachError) throw err
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw new Error(
        `runBudgetCheck: unexpected error reading cost evidence at ${costEvidencePath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
    process.stderr.write('[arbiter] warn: cost evidence not found — budget assertion skipped\n')
  }
}

// ─── Clear-strategy decision (#1209) ─────────────────────────────────────────────────────────────

/** Max units that fit comfortably in-context without a /clear. */
const INLINE_MAX = 10
/** Max units that can be handled via a sub-agent handoff (no full /clear needed). */
const SUBAGENT_MAX = 20

const STRATEGY_DESCRIPTION: Record<'inline' | 'sub-agent' | 'stop', string> = {
  inline: 'Strategy: inline (context is small — continuing in-context)',
  'sub-agent': 'Strategy: sub-agent (medium context — spawn a sub-agent for the exec phase)',
  stop: 'Strategy: stop (large context — run /clear then re-invoke to free context)',
}

/** Compute the appropriate clear strategy given known context pressure.
 *
 *  When `units` is absent, conservatively defaults to `'stop'` (backward-compatible: all
 *  existing callers that do not pass --units continue to throw the interactive handoff).
 *  Callers supply `units` from the plan §7 estimate — no auto-inference.
 */
export function decideClearStrategy({
  units,
  modelSwitch,
}: {
  units: number | undefined
  modelSwitch: boolean
}): 'inline' | 'sub-agent' | 'stop' {
  if (!modelSwitch) return 'inline'
  if (units === undefined) return 'stop'
  if (units <= INLINE_MAX) return 'inline'
  if (units <= SUBAGENT_MAX) return 'sub-agent'
  return 'stop'
}

/** Build the clear+resume banner that replaces the terse HandoffRequiredError message. */
export function buildHandoffBanner({
  taskId,
  strategy,
  units,
  tier,
}: {
  taskId: string
  strategy: 'inline' | 'sub-agent' | 'stop'
  units: number | undefined
  tier: string | undefined
}): string {
  const numericId = taskId.replace(/^#/, '')
  const tierInfo = tier !== undefined ? ` (tier: ${tier})` : ''
  const unitsInfo = units !== undefined ? `, units: ${units}` : ''
  const resumeCmd = `arbiter ship #${numericId} --advance --post-clear`
  const continueHint =
    strategy === 'inline'
      ? `Continue in this context: run \`${resumeCmd}\` or \`arbiter task advance --to red --post-clear\``
      : strategy === 'sub-agent'
        ? `Spawn a sub-agent for the exec phase, then pass \`--post-clear\` on re-entry:\n  \`${resumeCmd}\``
        : `1. Run: /clear\n2. Re-invoke: \`${resumeCmd}\``
  return [
    `━━━ Plan complete — handoff required ━━━`,
    `Task: ${taskId}${tierInfo}${unitsInfo}`,
    STRATEGY_DESCRIPTION[strategy],
    ``,
    continueHint,
    ``,
    `Flag: --post-clear signals the re-entry to the budget gate.`,
  ].join('\n')
}

/** Record the planning transcript window into the cost evidence file exactly once (#1208).
 *  The postClearCostRecorded marker guards against double-counting when runBudgetCheck throws
 *  on a budget breach and the caller retries. Marker written AFTER recordPhaseCost: if we
 *  crash between the two writes the worst outcome is a re-count (false breach, recoverable via
 *  ARBITER_COST_BUDGET_SKIP=1) rather than a missed count (false pass). */
function recordPlanningCostOnce(
  taskId: string,
  existing: Partial<UnifiedTaskState>,
  dir: string,
): void {
  if (existing.postClearCostRecorded !== undefined) return
  const caps = detectHostCapabilities()
  const sinceISO = existing.planningHandoffReady ?? new Date(0).toISOString()
  const costs = caps.transcriptPath
    ? readTranscriptCosts(caps.transcriptPath, sinceISO)
    : { input: 0, output: 0, samples: 0 }
  recordPhaseCost(
    taskId,
    'red',
    { in: costs.input, out: costs.output, samples: costs.samples },
    dir,
  )
  writeUnifiedState(dir, { postClearCostRecorded: new Date().toISOString() })
}

function handlePostClearReEntry(rawId: string, dir: string, opts: TaskAdvanceOptions): void {
  const existing: Partial<UnifiedTaskState> = readUnifiedState(dir) ?? {}

  // Fast path: already fully resumed — this call is a no-op.
  if (existing.postClearResumed !== undefined) return

  // Resolve the canonical task id. Prefer the one persisted in state (authoritative) over the
  // raw id from disk which may be 'unknown' if state was not initialized yet.
  const taskId = existing.taskId || (rawId !== 'unknown' ? rawId : undefined)
  if (!taskId) {
    throw new Error(
      `Post-clear re-entry: task state has no taskId — refusing to record cost under unknown.json. ` +
        `Re-initialize the task with \`arbiter task init --id #NNN\` before resuming. ` +
        `(rawId="${rawId}", existing.taskId="${existing.taskId ?? ''}")`,
    )
  }

  recordPlanningCostOnce(taskId, existing, dir)
  runBudgetCheck(taskId, dir, opts)
  // Metadata only — never the phase. runTaskAdvance writes phase:'red' AFTER this returns,
  // which is what keeps the `current !== to` budget-gate trigger load-bearing (C1, #1206).
  writeUnifiedState(dir, { postClearResumed: new Date().toISOString() })
}

function checkHandoffGate(dir: string, claudeDir: string, opts: TaskAdvanceOptions): void {
  void claudeDir
  const rawId = readTaskIdFromDisk(dir) ?? 'unknown'

  const isPostClear = opts.postClear === true || process.env['ARBITER_POST_CLEAR'] === '1'

  if (isPostClear) {
    handlePostClearReEntry(rawId, dir, opts)
    return
  }

  const caps = detectHostCapabilities()
  if (!caps.modelSwitch) {
    // Inline handoff: record strategy only, no phase write. runTaskAdvance proceeds to red.
    writeUnifiedState(dir, { handoffStrategy: 'inline' })
    return
  }

  // Size-driven strategy: inline → proceed; sub-agent or stop → throw with banner (#1209).
  const strategy = decideClearStrategy({ units: opts.units, modelSwitch: caps.modelSwitch })
  if (strategy === 'inline') {
    writeUnifiedState(dir, { handoffStrategy: 'inline' })
    return
  }

  // Interactive handoff: record strategy + readiness marker, then THROW before any phase write.
  // The phase stays at the current planning phase until post-clear re-entry advances it (C1).
  writeUnifiedState(dir, {
    handoffStrategy: 'interactive',
    handoffReady: true,
    planningHandoffReady: new Date().toISOString(),
  })
  const tier = readUnifiedState(dir)?.tier
  throw new HandoffRequiredError(
    buildHandoffBanner({ taskId: rawId, strategy, units: opts.units, tier }),
  )
}
