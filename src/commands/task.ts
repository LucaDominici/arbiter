// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from '../utils/fs.js'
import { sanitizeTaskId } from '../review/dispatch.js'
import { runCli, type RunCliResult } from '../utils/run-cli.js'
import { loadTddEvidence, extractFailureSignature } from '../evidence/tdd.js'
import { shaExistsOnBranch, pathExistsInCommit } from '../evidence/git-checks.js'

export type TaskPhase =
  | 'preflight'
  | 'plan'
  | 'red-team-review'
  | 'red-team-rework'
  | 'implementation'
  | 'green'
  | 'verification'
  | 'complete'

export interface TaskStatusExtras {
  task?: string
  branch?: string
  [key: string]: unknown
}

export interface TaskStatus {
  phase: TaskPhase
  timestamps: Record<string, string>
  runId: string
  gateDecisions: string[]
  branch?: string
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
  'implementation',
  'green',
  'verification',
  'complete',
]

const LATERAL_PHASES: TaskPhase[] = ['red-team-rework']

export interface TaskAdvanceOptions {
  to: TaskPhase
  dir?: string
  reverse?: boolean
  /** Bypass the plan-review gate when target is implementation. Writes an audit record. */
  skipPlanReview?: boolean
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
    'Phase: red-team-review\nAction: Red-team agents running. Review .arbiter/evidence/redteam/<task-id>.json.\nNext: CRITICAL findings → arbiter task advance --to red-team-rework. All clear → arbiter task advance --to implementation.',
  'red-team-rework':
    'Phase: red-team-rework\nAction: Critical findings require plan revision. Fix plan, then re-run red-team.\nNext: arbiter task advance --to red-team-review (re-triggers review) or --to plan (full replan).',
  implementation:
    'Phase: implementation\nAction: Implementation in progress. Check git status and .claude/.task-plan.\nNext: Resume TDD cycle (red → green → refactor), then run node scripts/check-all.mjs L1.',
  green:
    'Phase: green\nAction: Record TDD evidence for this task.\nNext: arbiter task record-red --test-path <path>, then arbiter task advance --to verification.',
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

export interface WriteBacklogOptions {
  taskDir: string
  taskId: string
  content: string
}

/** Write `<repoRoot>/.arbiter/evidence/<sanitized-id>/BACKLOG.md` atomically. */
export function writeBacklog({ taskDir, taskId, content }: WriteBacklogOptions): void {
  const sanit = sanitizeTaskId(taskId)
  const target = backlogPath(taskDir, sanit)
  mkdirSync(join(taskDir, '.arbiter', 'evidence', sanit), { recursive: true })
  writeFile(target, content)
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

  const phaseGates: Partial<Record<TaskPhase, () => void>> = {
    implementation: () => {
      checkPlanReviewGate(dir, claudeDir, opts)
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
