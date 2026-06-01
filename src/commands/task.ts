// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from '../utils/fs.js'
import { sanitizeTaskId } from '../review/dispatch.js'
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

export type TaskPhase =
  | 'preflight'
  | 'plan'
  | 'red-team-review'
  | 'red-team-rework'
  | 'red'
  | 'green'
  | 'refactor'
  | 'verification'
  | 'complete'

export type HandoffStrategy = 'interactive' | 'inline' | null

export interface TaskStatusExtras {
  task?: string
  branch?: string
  handoffStrategy?: HandoffStrategy
  planningHandoffReady?: string
  postClearResumed?: string
  hostCapabilities?: { modelSwitch: boolean; transcriptAvailable: boolean }
  cost?: { byPhase: Record<string, { in: number; out: number; samples: number }> }
  [key: string]: unknown
}

export interface TaskStatus {
  phase: TaskPhase
  timestamps: Record<string, string>
  runId: string
  gateDecisions: string[]
  branch?: string
  handoffStrategy?: HandoffStrategy
  planningHandoffReady?: string
  postClearResumed?: string
  hostCapabilities?: { modelSwitch: boolean; transcriptAvailable: boolean }
  cost?: { byPhase: Record<string, { in: number; out: number; samples: number }> }
  [key: string]: unknown
}

export interface WriteTaskStatusOptions {
  taskDir: string
  phase: TaskPhase
  extras?: TaskStatusExtras
}

/**
 * Atomically write status.json to taskDir via temp-file + rename.
 * Merges timestamps from any existing status.json before writing.
 */
export function writeTaskStatus({ taskDir, phase, extras }: WriteTaskStatusOptions): void {
  const target = join(taskDir, 'status.json')

  let existingTimestamps: Record<string, string> = {}
  try {
    const existing = JSON.parse(readFileSync(target, 'utf-8')) as Partial<TaskStatus>
    existingTimestamps = existing.timestamps ?? {}
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `writeTaskStatus: failed to read existing status at ${target}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  const now = new Date().toISOString()
  const status: TaskStatus = {
    ...extras,
    phase,
    timestamps: { ...existingTimestamps, [phase]: now },
    runId: `${process.pid}-${Date.now()}`,
    gateDecisions: [],
  }

  writeFile(target, JSON.stringify(status, null, 2) + '\n')
}

const PHASE_ORDER: TaskPhase[] = [
  'preflight',
  'plan',
  'red-team-review',
  'red',
  'green',
  'refactor',
  'verification',
  'complete',
]

const LATERAL_PHASES: TaskPhase[] = ['red-team-rework']

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
}

function isValidPhase(s: string): s is TaskPhase {
  return (
    (PHASE_ORDER as readonly string[]).includes(s) ||
    (LATERAL_PHASES as readonly string[]).includes(s)
  )
}

function readPhase(claudeDir: string): TaskPhase {
  const p = join(claudeDir, '.task-phase')
  try {
    const raw = readFileSync(p, 'utf-8').trim()
    if (!raw) return 'preflight'
    // Migrate legacy 'implementation' to 'red' (#549) — write once so subsequent reads are native
    if (raw === 'implementation') {
      const timestamp = new Date().toISOString()
      writeFileSync(p, 'red\n')
      try {
        appendFileSync(
          join(claudeDir, '.task-phase-history'),
          `${timestamp} implementation → red [auto-migrated]\n`,
        )
      } catch (histErr) {
        process.stderr.write(
          `Warning: could not write migration audit to .task-phase-history: ${String(histErr)}\n`,
        )
      }
      return 'red'
    }
    if (!isValidPhase(raw)) {
      throw new Error(
        `Corrupted phase file at ${p}: unexpected value "${raw}". ` +
          `Valid phases: ${PHASE_ORDER.join(', ')}. ` +
          `Remove the file and re-run with --to preflight to reset.`,
      )
    }
    return raw
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'preflight'
    throw err
  }
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
  const claudeDir = join(root, '.claude')
  const phase = readPhase(claudeDir)

  let taskId: string | undefined
  try {
    const taskIdRaw = readFileSync(join(claudeDir, '.task-id'), 'utf-8').trim()
    if (taskIdRaw) taskId = taskIdRaw
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `runTaskResume: failed to read .task-id: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  const header = taskId ? `Task: ${taskId}\n` : ''
  const recovery = RECOVERY_TABLE[phase]
  process.stdout.write(`${header}${recovery}\n`)
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
  const p = join(dir, '.claude', '.task-id')
  if (!existsSync(p)) return undefined
  const raw = readFileSync(p, 'utf-8').trim()
  return raw.length > 0 ? raw : undefined
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
      'No task id provided and .claude/.task-id missing. Pass --task <id> to recover.\n',
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

export interface RequirePlanReviewPassOptions {
  dir: string
  taskId: string
  planContent?: string
}

export interface RequirePlanReviewPassResult {
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
export function requirePlanReviewPass(
  opts: RequirePlanReviewPassOptions,
): RequirePlanReviewPassResult {
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
  const ptr = join(dir, '.claude', '.task-plan')
  if (!existsSync(ptr)) return undefined
  const planPath = readFileSync(ptr, 'utf-8').trim()
  if (planPath.length === 0 || !existsSync(planPath)) return undefined
  return readFileSync(planPath, 'utf-8')
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

  const current = readPhase(claudeDir)

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

  mkdirSync(claudeDir, { recursive: true })
  const timestamp = new Date().toISOString()
  writeFileSync(join(claudeDir, '.task-phase'), to + '\n')
  appendFileSync(join(claudeDir, '.task-phase-history'), `${timestamp} ${current} → ${to}\n`)
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

function handlePostClearReEntry(
  rawId: string,
  taskDir: string,
  dir: string,
  opts: TaskAdvanceOptions,
): void {
  let existing: Partial<TaskStatus> = {}
  try {
    existing = JSON.parse(
      readFileSync(join(taskDir, 'status.json'), 'utf-8'),
    ) as Partial<TaskStatus>
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `checkHandoffGate: failed to read status at ${join(taskDir, 'status.json')}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }
  if (existing.postClearResumed === undefined) {
    const caps = detectHostCapabilities()
    const sinceISO = existing.planningHandoffReady ?? new Date(0).toISOString()
    const costs = caps.transcriptPath
      ? readTranscriptCosts(caps.transcriptPath, sinceISO)
      : { input: 0, output: 0, samples: 0 }
    recordPhaseCost(
      rawId,
      'red',
      { in: costs.input, out: costs.output, samples: costs.samples },
      dir,
    )
    runBudgetCheck(rawId, dir, opts)
    writeTaskStatus({
      taskDir,
      phase: 'red',
      extras: { ...existing, postClearResumed: new Date().toISOString() },
    })
  }
}

function checkHandoffGate(dir: string, claudeDir: string, opts: TaskAdvanceOptions): void {
  const rawId = readTaskIdFromDisk(dir) ?? 'unknown'
  const sanit = sanitizeTaskId(rawId)
  const taskDir = join(claudeDir, '.task-' + sanit)
  mkdirSync(taskDir, { recursive: true })

  const isPostClear = opts.postClear === true || process.env['ARBITER_POST_CLEAR'] === '1'

  if (isPostClear) {
    handlePostClearReEntry(rawId, taskDir, dir, opts)
    return
  }

  const caps = detectHostCapabilities()
  if (!caps.modelSwitch) {
    writeTaskStatus({ taskDir, phase: 'red', extras: { handoffStrategy: 'inline' } })
    return
  }

  writeTaskStatus({
    taskDir,
    phase: 'red',
    extras: {
      handoffStrategy: 'interactive',
      planningHandoffReady: new Date().toISOString(),
    },
  })
  writeFileSync(join(claudeDir, '.task-handoff-ready'), '', 'utf-8')
  throw new HandoffRequiredError(
    'Plan complete. Run `/clear`, then re-invoke `/task #' +
      rawId.replace(/^#/, '') +
      '` (it will resume from disk).',
  )
}
