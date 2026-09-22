// SPDX-License-Identifier: Apache-2.0
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readFileTranslated } from '../utils/fs.js'
import { sanitizeTaskId } from '../utils/task-id.js'
import { normalizeChainId } from './task-state.js'
import { getBoolFlag, getNumberFlag } from '../config/env-registry.js'
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
  reviewStateOf,
  invalidateTaskReceipts,
} from './task-state.js'
import { getLogger } from '../utils/logger.js'
import { runCli, type RunCliResult } from '../utils/run-cli.js'
import { evaluateMerged, type MergedVerdict, type PrSnapshot } from './pr-merged.js'
import { shipConfigFor, permitsGitHubCalls } from './ship-config.js'
import { UserFacingError } from '../utils/errors.js'
import { t } from '../i18n/index.js'
import { loadTddEvidence, extractFailureSignature } from '../evidence/tdd.js'
import { verifyGreenExecution } from '../evidence/tdd-reexecute.js'
import {
  pathExistsInCommit,
  resolveEvidenceCommit,
  tddEvidenceProducedOnBranch,
} from '../evidence/git-checks.js'
import { loadConfig } from '../utils/config.js'
import { verifyGatePassMarker, verifyDoneEvidenceReceipt } from '../evidence/gate-binding.js'
import {
  planReviewRound,
  resolveReviewMaxRounds,
  type PlannedReviewRound,
  type ReviewRoundEnvelope,
} from './ship-review.js'
import { isShipTreatment } from './ship-tier.js'

// Task-state vocabulary and the unified-document I/O live in `./task-state.ts`.
// Re-export the phase types here so existing importers (e.g. src/cli.ts) keep their import path.
export type { TaskPhase } from './task-state.js'

interface TaskAdvanceOptions {
  to: TaskPhase
  dir?: string
  reverse?: boolean
  /**
   * #2402 — `--no-pr`: this repo lands by direct push (trunk mode), so there is no PR to verify.
   * The escape hatch is LOGGED, never silent: a task that completed without a merged PR must say
   * so in the digest.
   */
  noPr?: boolean
  /** #2402 — `--pr <n>`: name the PR to verify when the branch carries more than one. */
  pr?: number
  /** Test seam for the `gh pr list` reader, so the gate is testable without a network. */
  readPrs?: (branch: string, dir: string) => PrSnapshot[]
  /** Test seam for proving a merged PR remains reachable from current origin/main. */
  isMergeReachable?: (mergeSha: string, dir: string) => boolean
  /** Test seam for the current commit CI reader used by direct landing. */
  readCommitCi?: (sha: string, dir: string) => NonNullable<PrSnapshot['statusCheckRollup']>
  /** Test seam for the review candidate HEAD opened when entering refactor. */
  headSha?: string | null
}

interface TaskReviewRoundOptions {
  dir?: string
  forceReview?: boolean
  reviewMaxRounds?: number
  headSha?: string | null
  /** Retry an incomplete round at the same frozen HEAD for a runtime-owned reviewer seat. */
  retryIncomplete?: boolean
}

/** Current phase from the unified document (`preflight` for a fresh tree). */
function currentPhase(root: string): TaskPhase {
  return readUnifiedState(root)?.phase ?? 'preflight'
}

interface TaskResumeOptions {
  dir?: string
}

const RECOVERY_TABLE: Record<TaskPhase, string> = {
  preflight:
    'Phase: preflight\nAction: Run arbiter ship #NNN to initialize the task branch and plan.',
  plan: 'Phase: plan\nAction: Plan is being written. Review .claude/plans/ for existing plan draft.\nNext: Enter RED after mechanical plan admission; ask only for unresolved product decisions.',
  red: 'Phase: red\nAction: Write failing tests first. No implementation yet.\nNext: Tests written → arbiter lifecycle advance --to green.',
  green:
    'Phase: green\nAction: Make tests pass with minimal implementation.\nNext: All tests green → arbiter lifecycle advance --to refactor.',
  refactor:
    'Phase: refactor\nAction: Clean up implementation. Tests must stay green.\nNext: Refactor done → arbiter lifecycle advance --to verification.',
  verification:
    'Phase: verification\nAction: The pre-push hook already ran one preflight; CI owns the full gate.\nNext: Record the exact-head CI verdict with node scripts/ci-receipt.mjs, then arbiter lifecycle advance --to close.',
  close:
    'Phase: close\nAction: CLOSER mode active — the closer-mode guard is wired in settings. Single named target, no new issues/refactor beyond the diff (findings → PARKING), no gate-appeasement deletions. Same error twice → 5-line root-cause or declare BLOCKED.\nNext: Commit, push, open/land the PR; foreground-wait on its checks. Merged + evidence → arbiter lifecycle advance --to complete.',
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

interface TaskInitOptions {
  dir?: string
  id?: string
  tier?: string
  plan?: string
  /** #2102 — `--chain <id>` (repeatable): other issue ids batched into this task's worktree. */
  chainIds?: string[]
  /** Native-host test seam; CLI callers use the live process context. */
  host?: NativeHostContext
  /** Exact worktree for the explicit `task host-preflight` command. */
  worktree?: string
}

interface NativeHostBinding {
  bindingId: string
  worktreePath: string
  branch: string
  sessionId?: string
  transcriptPath?: string
}

interface NativeHostContext {
  cwd?: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

interface TaskHostPreflightOptions {
  id: string
  worktree: string
  dir?: string
  host?: NativeHostContext
}

const CLAUDE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

function encodeClaudeProjectPath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

function git(cwd: string, args: string[]): string {
  return runCli('git', args, { cwd, timeoutMs: 5000 }).stdout.trim()
}

function readOpenLog(worktree: string): unknown[] {
  const commonDir = resolve(worktree, git(worktree, ['rev-parse', '--git-common-dir']))
  const path = join(dirname(commonDir), '.arbiter', 'worktree-open.log.json')
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('worktree-open log is not a regular file')
  const parsed: unknown = JSON.parse(readFileTranslated(path, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('worktree-open log is malformed')
  return parsed
}

function matchesOpenLog(entry: unknown, taskId: string, worktreePath: string, branch: string) {
  if (entry === null || typeof entry !== 'object') return false
  const row = entry as Record<string, unknown>
  return (
    row['taskId'] === taskId && row['worktreePath'] === worktreePath && row['branch'] === branch
  )
}

function openLogBindingId(taskId: string, worktreePath: string, branch: string): string {
  const matches = readOpenLog(worktreePath).filter((entry) =>
    matchesOpenLog(entry, taskId, worktreePath, branch),
  )
  if (matches.length !== 1)
    throw new Error(`exact worktree binding for ${taskId} is missing or ambiguous`)
  const bindingId = (matches[0] as Record<string, unknown>)['bindingId']
  if (typeof bindingId !== 'string' || bindingId.length === 0)
    throw new Error(`exact worktree binding for ${taskId} has no binding id; re-adopt it`)
  return bindingId
}

function assertClaudeProjectDir(worktreePath: string, projectDir: string | undefined): void {
  if (!projectDir) return
  let projectPath
  try {
    projectPath = realpathSync(projectDir)
  } catch {
    throw new Error('CLAUDE_PROJECT_DIR is not a readable project directory')
  }
  if (projectPath !== worktreePath)
    throw new Error(`CLAUDE_PROJECT_DIR ${projectPath} does not match worktree ${worktreePath}`)
}

function optionalSessionId(env: NodeJS.ProcessEnv): string | undefined {
  const sessionId = env['CLAUDE_CODE_SESSION_ID']
  if (sessionId === undefined) return undefined
  if (!CLAUDE_SESSION_ID.test(sessionId))
    throw new Error('native host binding requires a valid CLAUDE_CODE_SESSION_ID')
  return sessionId
}

function requireTranscript(worktreePath: string, sessionId: string, homeDir: string): string {
  const transcriptPath = join(
    homeDir,
    '.claude',
    'projects',
    encodeClaudeProjectPath(worktreePath),
    `${sessionId}.jsonl`,
  )
  const stat = lstatSync(transcriptPath)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('native host transcript is not a regular file')
  if (realpathSync(transcriptPath) !== resolve(transcriptPath))
    throw new Error('native host transcript resolves through a symlink')
  return transcriptPath
}

function resolveNativeCheckoutBinding(
  taskId: string,
  requestedWorktree: string,
  context: NativeHostContext = {},
): NativeHostBinding {
  const worktreePath = realpathSync(requestedWorktree)
  const cwd = realpathSync(context.cwd ?? process.cwd())
  if (cwd !== worktreePath)
    throw new Error(`native host root ${cwd} does not match worktree ${worktreePath}`)
  const branch = git(worktreePath, ['branch', '--show-current'])
  if (branch.length === 0) throw new Error('native checkout must have an explicit branch')
  const canonicalTask = taskId.startsWith('#') ? taskId : `#${taskId}`
  const bindingId = openLogBindingId(canonicalTask, worktreePath, branch)
  return { bindingId, worktreePath, branch }
}

function resolveNativeHostBinding(
  taskId: string,
  requestedWorktree: string,
  context: NativeHostContext = {},
): NativeHostBinding {
  const binding = resolveNativeCheckoutBinding(taskId, requestedWorktree, context)
  const env = context.env ?? process.env
  assertClaudeProjectDir(binding.worktreePath, env['CLAUDE_PROJECT_DIR'])
  const sessionId = optionalSessionId(env)
  if (sessionId === undefined) return binding
  return {
    ...binding,
    sessionId,
    transcriptPath: requireTranscript(
      binding.worktreePath,
      sessionId,
      context.homeDir ?? homedir(),
    ),
  }
}

function runTaskHostPreflight(opts: TaskHostPreflightOptions): void {
  const root = opts.dir ?? opts.worktree
  const taskId = normalizeChainId(opts.id)
  let hostBinding
  try {
    hostBinding = resolveNativeHostBinding(taskId, opts.worktree, opts.host)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `${reason}\nRecovery: cd ${JSON.stringify(opts.worktree)} && ` +
        'claude --resume "$CLAUDE_CODE_SESSION_ID" --fork-session --permission-mode auto',
      { cause: err },
    )
  }
  if (realpathSync(root) !== hostBinding.worktreePath) {
    throw new Error('task write root does not match the bound worktree')
  }
  const previousBinding = readUnifiedState(root)?.hostBinding?.bindingId
  if (previousBinding !== undefined && previousBinding !== hostBinding.bindingId) {
    invalidateTaskReceipts(root, taskId)
  }
  writeUnifiedState(root, { taskId, branch: hostBinding.branch, hostBinding })
  appendLog(
    root,
    `host-preflight ${taskId} binding=${hostBinding.bindingId} host=${hostBinding.sessionId ? 'claude' : 'git'}`,
  )
  process.stdout.write(`host-preflight: OK — ${hostBinding.worktreePath}\n`)
}

function requestedTaskMatches(requestedTaskId: string | undefined, boundTaskId: string): boolean {
  if (requestedTaskId === undefined) return true
  return normalizeChainId(requestedTaskId) === boundTaskId
}

function assertNativeCheckoutIdentity(
  root: string,
  requestedTaskId: string | undefined,
  state: UnifiedTaskState,
  binding: NativeHostBinding,
  host: NativeHostContext,
): void {
  if (realpathSync(root) !== binding.worktreePath) {
    throw new Error('task write root does not match the native host binding')
  }
  if (!requestedTaskMatches(requestedTaskId, state.taskId)) {
    throw new Error('task id does not match the native host binding')
  }
  const live = resolveNativeCheckoutBinding(state.taskId, binding.worktreePath, host)
  if (
    live.bindingId !== binding.bindingId ||
    live.worktreePath !== binding.worktreePath ||
    live.branch !== binding.branch
  ) {
    throw new Error('native host binding is stale — run arbiter lifecycle preflight again')
  }
}

function assertNativeTranscriptAttestation(
  binding: NativeHostBinding,
  host: NativeHostContext,
): void {
  const env = host.env ?? process.env
  assertClaudeProjectDir(binding.worktreePath, env['CLAUDE_PROJECT_DIR'])
  if (binding.sessionId === undefined) return
  const sessionId = optionalSessionId(env)
  if (
    sessionId !== binding.sessionId ||
    requireTranscript(binding.worktreePath, sessionId, host.homeDir ?? homedir()) !==
      binding.transcriptPath
  ) {
    throw new Error('native host binding is stale — run arbiter lifecycle preflight again')
  }
}

function assertBoundNativeHost(
  root: string,
  requestedTaskId: string | undefined,
  host: NativeHostContext = {},
): void {
  const state = readUnifiedState(root)
  if (!state?.hostBinding) return
  const binding = state.hostBinding
  assertNativeCheckoutIdentity(root, requestedTaskId, state, binding, host)
  assertNativeTranscriptAttestation(binding, host)
}

/** Require the exact checkout binding before `/ship` creates or changes task state. */
export function assertShipHostBinding(
  root: string,
  requestedTaskId?: string,
  linkedCheckout: (root: string) => boolean = isLinkedCheckout,
): void {
  if (!linkedCheckout(root)) return
  const state = readUnifiedState(root)
  if (state?.hostBinding !== undefined) {
    assertBoundNativeHost(root, requestedTaskId)
    return
  }
  const taskId = normalizeChainId(requestedTaskId ?? state?.taskId ?? '')
  const worktree = realpathSync(root)
  const prepare = `arbiter worktree prepare ${JSON.stringify(taskId)} ${JSON.stringify(worktree)}`
  const preflight =
    `arbiter lifecycle preflight --id ${JSON.stringify(taskId)} ` +
    `--worktree ${JSON.stringify(worktree)}`
  throw new Error(`native host binding is missing. Run \`${prepare} && ${preflight}\`.`)
}

function initializeHostPreflight(opts: TaskInitOptions): boolean {
  if (opts.worktree === undefined) return false
  if (opts.id === undefined) throw new Error('task host-preflight requires a task id')
  const preflight: TaskHostPreflightOptions = { id: opts.id, worktree: opts.worktree }
  if (opts.dir !== undefined) preflight.dir = opts.dir
  if (opts.host !== undefined) preflight.host = opts.host
  runTaskHostPreflight(preflight)
  return true
}

function taskInitLog(state: UnifiedTaskState): string {
  return `init task ${state.taskId || '(unset)'} tier=${state.tier || '(unset)'}`
}

function configuredTaskPatch(root: string): TaskStatePatch {
  const collaborationMode = loadConfig(root)?.collaborationMode
  return collaborationMode === undefined ? {} : { collaborationMode }
}

/**
 * #2773 — anchor-time gate derivation. Recomputes derivedGates from the plan's `files:` manifest
 * every time `lifecycle start --plan` (re-)anchors a plan, so an edit to the manifest without a
 * re-anchor leaves the stored value stale and checkPlanDerivedGates (check-acceptance.mjs) refuses
 * the plan->red transition. Advisory here: a missing script or a plan not yet written is a silent
 * no-op — the red-phase gate is the actual enforcement point and rejects missing support.
 */
function derivePlanGates(root: string, plan: string): void {
  const script = join(root, 'scripts', 'derive-plan-gates.mjs')
  if (!existsSync(script)) return
  // Best-effort: a malformed status.json or plan should not fail `lifecycle start` itself —
  // checkPlanDerivedGates (check-acceptance.mjs) is the actual enforcement point and fails
  // closed at plan->red if derivedGates ends up missing or stale.
  try {
    runCli('node', [script, root, plan], { cwd: root, timeoutMs: 5000 })
  } catch (err) {
    // Non-fatal (see comment above) but not silent: a genuine internal failure here (as opposed
    // to derive-plan-gates.mjs's own advisory SKIPs, which exit 0) would otherwise leave zero
    // trace while a prior run's stale derivedGates stays on status.json unchanged.
    getLogger().warn(
      'task.derive_plan_gates_failed',
      { error: err instanceof Error ? err.message : String(err) },
      `derivePlanGates: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Initialise / update the unified task document from the slash-command shell layer (replaces the
 * historical per-task dotfile writes). Never advances the phase.
 */
export function runTaskInit(opts: TaskInitOptions = {}): void {
  if (initializeHostPreflight(opts)) return
  const root = opts.dir ?? process.cwd()
  assertBoundNativeHost(root, opts.id, opts.host)
  const patch = configuredTaskPatch(root)
  if (opts.id !== undefined) patch.taskId = opts.id
  if (opts.tier !== undefined) patch.tier = opts.tier
  if (opts.plan !== undefined) patch.plan = opts.plan
  // Keep malformed ids distinguishable from the multi-issue admission refusal below.
  if (opts.chainIds !== undefined) patch.chainIds = opts.chainIds.map(normalizeChainId)
  assertTaskInitSingleIssue(patch.chainIds)
  const branch = detectCurrentBranch(root)
  if (branch !== undefined) patch.branch = branch
  if (opts.id !== undefined && branch !== undefined && isLinkedCheckout(root)) {
    patch.hostBinding = resolveNativeHostBinding(opts.id, root, opts.host)
  }
  const state = writeUnifiedState(root, patch)
  if (opts.plan !== undefined) derivePlanGates(root, opts.plan)
  appendLog(root, taskInitLog(state))
}

/** `task init` has no admission inputs; multi-issue state must enter through `ship`. */
function assertTaskInitSingleIssue(chainIds: readonly string[] | undefined): void {
  if ((chainIds?.length ?? 0) === 0) return
  const seal = {
    reason: 'affinity' as const,
    detail:
      'task init cannot prove multi-issue admission; use `arbiter ship` with complete affinity and qualification signals',
  }
  throw new UserFacingError(t('errors.E_TRAIN_SEALED', seal))
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

function isLinkedCheckout(root: string): boolean {
  try {
    return (
      git(root, ['rev-parse', '--path-format=absolute', '--git-dir']) !==
      git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    )
  } catch {
    return false
  }
}

const GETTABLE_FIELDS = ['phase', 'taskId', 'tier', 'plan', 'tddPhase', 'lastAction', 'nextAction']

interface TaskGetOptions {
  dir?: string
  field: string
}

/**
 * #2435 — `.claude/.task/status.json` lives at a FIXED path, so a checkout that never ran
 * `task init` still reads whatever the previous task left behind. A maintainer starting
 * fresh was told, silently and with exit 0, that their task was already seeded at some
 * phase — state belonging to an unrelated, long-finished branch.
 *
 * The warning goes to stderr so the documented single-value stdout contract
 * (`task get --field phase` in a shell substitution) is untouched; it is the visibility
 * that was missing, not the value. Silent when the checkout is not a git work tree, or
 * when the document records no branch (written before branch stamping existed).
 */
function warnOnForeignTaskState(root: string, state: UnifiedTaskState): void {
  const recorded = state.branch
  if (recorded === undefined || recorded.length === 0) return
  const actual = detectCurrentBranch(root)
  if (actual === undefined || actual === recorded) return
  process.stderr.write(
    `WARNING: task state is foreign — .claude/.task/status.json records task ${state.taskId || '(none)'} ` +
      `on branch "${recorded}", but the checkout is on "${actual}". ` +
      `The value below belongs to that other task. Run \`arbiter lifecycle start --id <id>\` to seed this one.\n`,
  )
}

/**
 * Print a single task-state field to stdout for shell consumers (replaces `cat .claude/.task-*`).
 * Exit 2 on an unknown field name.
 */
export function runTaskGet(opts: TaskGetOptions): void {
  const root = opts.dir ?? process.cwd()
  const s = readUnifiedState(root)
  if (s) warnOnForeignTaskState(root, s)
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

function backlogPath(dir: string, sanitisedId: string): string {
  return join(dir, '.arbiter', 'evidence', sanitisedId, 'BACKLOG.md')
}

interface TaskRecoverOptions {
  dir?: string
  taskId?: string
  runner?: Runner
}

function readTaskIdFromDisk(dir: string): string | undefined {
  return readTaskId(dir)
}

function recordedRecovery(state: UnifiedTaskState | null, taskId: string): string | null {
  if (state?.taskId !== taskId) return null
  return (
    [
      `Task: ${taskId} · phase: ${state.phase} · plan: ${state.plan}`,
      `Candidate: ${state.review?.lastReviewedSha ?? 'not frozen'} · review round: ${state.review?.rounds ?? 0}`,
      `Observed: ${state.cursor.lastAction || 'NO DATA'}`,
      `Next: ${state.cursor.nextAction || RECOVERY_TABLE[state.phase]}`,
      'Evidence: .arbiter/agents-dispatched.json; .arbiter/gate-pass.json (verify subject before reuse)',
    ].join('\n') + '\n'
  )
}

function recoveryLayerLines(dir: string, sanit: string, runner: Runner): string[] {
  const parts: string[] = []
  const backlog = backlogPath(dir, sanit)
  if (existsSync(backlog)) {
    parts.push('━━━ Layer 1: BACKLOG.md ━━━')
    parts.push(readFileTranslated(backlog, 'utf-8'))
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
  return parts
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
  const recovery = recordedRecovery(readUnifiedState(dir), rawId)
  if (recovery !== null) {
    process.stdout.write(recovery)
    return
  }
  const sanit = sanitizeTaskId(rawId)
  const runner = opts.runner ?? defaultRunner

  const parts = [
    `━━━ Recovery for task ${rawId} (sanitized: ${sanit}) ━━━\n`,
    ...recoveryLayerLines(dir, sanit, runner),
  ]
  parts.push(
    'Use the issue, plan and recorded evidence to restore the next action; absent proof remains NO DATA.',
  )

  process.stdout.write(parts.join('\n') + '\n')
}

/**
 * Require a current gate pass, bound to THIS tree, before leaving the closing phases.
 * `close` accepts the fast L1 marker so the operator can reach the final pre-push gate;
 * `complete` calls this with L2 and remains the strict completion boundary.
 *
 * #2328: the verdict is computed in-engine (see src/evidence/gate-binding.ts) —
 * never by running a script out of the tree being gated — and every identity
 * axis fails closed: schema, level, age, commit, branch, checkout, toolchain
 * and working-tree content.
 */
/**
 * #2402 — read the branch's PRs. Through `runCli` (INV-12: no raw child_process under `src/`),
 * with a short timeout — this runs inside a phase gate, not a watcher.
 */
function readBranchPrs(branch: string, dir: string, candidateSha?: string): PrSnapshot[] {
  const out = runCli(
    'gh',
    [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--json',
      'number,state,mergeStateStatus,statusCheckRollup,headRefOid,mergeCommit,mergedAt,baseRefName',
    ],
    { cwd: dir, timeoutMs: 30_000 },
  ).stdout
  const parsed: unknown = JSON.parse(out)
  const prs = Array.isArray(parsed) ? (parsed as PrSnapshot[]) : []
  if (!candidateSha || !prs.some((pr) => pr.state === 'MERGED' && pr.headRefOid === candidateSha)) {
    return prs
  }
  const checks = readCommitCi(candidateSha, dir)
  return prs.map((pr) =>
    pr.headRefOid === candidateSha ? { ...pr, statusCheckRollup: checks } : pr,
  )
}

const COMMIT_CI_QUERY = `query($owner:String!,$name:String!,$sha:GitObjectID!,$endCursor:String) {
  repository(owner:$owner,name:$name) { object(oid:$sha) { ... on Commit {
    statusCheckRollup { contexts(first:100,after:$endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on CheckRun { name conclusion completedAt checkSuite { createdAt branch { name } workflowRun { event } } }
        ... on StatusContext { context state createdAt }
      }
    } }
  } } }
}`

interface CiPage {
  data: {
    repository: {
      object: {
        statusCheckRollup: {
          contexts: {
            nodes: GraphqlCiCheck[]
            pageInfo: { hasNextPage: boolean }
          }
        }
      }
    }
  }
}

type GraphqlCiCheck = Omit<NonNullable<PrSnapshot['statusCheckRollup']>[number], 'checkSuite'> & {
  checkSuite?: {
    createdAt?: string
    branch?: { name?: string } | null
    workflowRun?: { event?: string } | null
  } | null
}

function normalizeGraphqlCiCheck(
  check: GraphqlCiCheck,
): NonNullable<PrSnapshot['statusCheckRollup']>[number] {
  const { checkSuite: suite, ...rest } = check
  if (suite === undefined) return rest
  if (suite === null) return { ...rest, checkSuite: null }
  const { branch: graphqlBranch, ...suiteRest } = suite
  const branch = graphqlBranch?.name
  return {
    ...rest,
    checkSuite: { ...suiteRest, ...(branch === undefined ? {} : { branch }) },
  }
}

function readCommitCi(sha: string, dir: string): NonNullable<PrSnapshot['statusCheckRollup']> {
  const out = runCli(
    'gh',
    [
      'api',
      'graphql',
      '--paginate',
      '--slurp',
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-f',
      `sha=${sha}`,
      '-f',
      `query=${COMMIT_CI_QUERY}`,
    ],
    { cwd: dir, timeoutMs: 30_000 },
  ).stdout
  const contexts = (JSON.parse(out) as CiPage[]).map(
    (page) => page.data.repository.object.statusCheckRollup.contexts,
  )
  if (
    contexts.length === 0 ||
    contexts.some(
      (page) => !Array.isArray(page.nodes) || typeof page.pageInfo.hasNextPage !== 'boolean',
    ) ||
    contexts.at(-1)?.pageInfo.hasNextPage !== false
  )
    throw new Error('Incomplete candidate CI pages')
  return contexts.flatMap((page) => page.nodes.map(normalizeGraphqlCiCheck))
}

/** The unverifiable / unmerged refusal, as one user-facing error. */
function prGateRefusal(detail: string): UserFacingError {
  return new UserFacingError(t('errors.E_PR_NOT_MERGED', { detail }))
}

/**
 * #2402 — `complete` means MERGED. The Iron Law said so; nothing enforced it, and a PR was
 * opened with red CI and abandoned while its task document read `complete`.
 *
 * FAIL-CLOSED in both directions that matter: an unreadable `gh` refuses rather than waving the
 * task through (an unverifiable landing is not a landing), and a repo that never declared the
 * GitHub axis is still verified. Only an explicit `useGitHub: false` or an explicit `--no-pr`
 * skips — and `--no-pr` is written to the digest log, so a completion without a merged PR stays
 * attributable. Split across prGateSkipped / prGateBranch / prGateSnapshots below to stay inside
 * the complexity-10 ratchet; `checkPrMergedGate` is the entry point.
 */

/** The branch to verify. Refuses when neither live git nor the task document names one. */
function prGateBranch(dir: string): string {
  // Live git first, then the branch `task init` stamped on the document — a detached HEAD or an
  // unavailable git must not become a silent skip when the task already recorded its branch.
  const branch = detectCurrentBranch(dir) ?? readUnifiedState(dir)?.branch
  if (branch === undefined || branch.length === 0) {
    throw prGateRefusal(
      'the current branch could not be determined, so the PR cannot be verified. ' +
        'Pass --no-pr if this repo lands by direct push.',
    )
  }
  return branch
}

/** The branch's PRs. An unreadable `gh` REFUSES here — an unverifiable landing is not a landing. */
function prGateSnapshots(
  dir: string,
  branch: string,
  opts: TaskAdvanceOptions,
  candidateSha?: string,
): readonly PrSnapshot[] {
  try {
    return opts.readPrs ? opts.readPrs(branch, dir) : readBranchPrs(branch, dir, candidateSha)
  } catch (err) {
    throw prGateRefusal(
      `\`gh pr list --head ${branch}\` failed (${err instanceof Error ? err.message : String(err)}). ` +
        'An unverifiable landing is not a landing: fix `gh`, or pass --no-pr if this repo lands by direct push.',
    )
  }
}

/**
 * The two explicit skips, each written to the digest log so a completion that did NOT verify a
 * merged PR stays attributable. Returns true when the gate is satisfied without a PR check.
 */
function prGateSkipped(dir: string, opts: TaskAdvanceOptions): boolean {
  if (opts.noPr === true) {
    const rawConfig = readRawArbiterConfig(dir)
    const policy = resolveDirectCompletionPolicy(rawConfig)
    if (!policy.ok) throw prGateRefusal(policy.reason)
    if (!hasRawGitHubPermission(rawConfig)) {
      throw prGateRefusal('direct post-main CI requires raw permitGitHub: true.')
    }
    const head = assertDirectHeadOnMain(dir)
    const checks = opts.readCommitCi?.(head, dir) ?? readCommitCi(head, dir)
    if (!successfulPostMainCi(checks)) {
      throw prGateRefusal('direct post-main CI cannot establish a successful candidate result.')
    }
    appendLog(dir, 'complete ← no-pr (direct landing)')
    return true
  }
  if (!permitsGitHubCalls(dir)) {
    // Skipped, never silent: a repo that has not set `permitGitHub: true` must not be shelled out
    // to, but a completion that skipped the landing check still has to be attributable.
    appendLog(dir, 'complete ← pr-check skipped (permitGitHub not set)')
    return true
  }
  return false
}

function assertDirectHeadOnMain(dir: string): string {
  try {
    const head = runCli('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 15_000 }).stdout.trim()
    const main = runCli('git', ['rev-parse', 'origin/main'], {
      cwd: dir,
      timeoutMs: 15_000,
    }).stdout.trim()
    if (head !== main)
      throw prGateRefusal('direct landing HEAD does not match current origin/main.')
    return head
  } catch (err) {
    if (err instanceof UserFacingError) throw err
    throw prGateRefusal(
      `direct landing cannot prove current origin/main (${err instanceof Error ? err.message : String(err)}).`,
    )
  }
}

function checkPrMergedGate(dir: string, opts: TaskAdvanceOptions, candidateSha?: string): void {
  if (opts.noPr !== true) {
    const rawConfig = readRawArbiterConfig(dir)
    if (!hasRawGitHubPermission(rawConfig)) {
      throw prGateRefusal('PR completion requires raw permitGitHub: true.')
    }
    if (candidateSha !== undefined) {
      const policy = resolveEvidenceCompletionPolicy(rawConfig, true)
      if (!policy.ok) throw prGateRefusal(policy.reason)
      if (policy.policy === 'direct') throw prGateRefusal('direct completion requires --no-pr.')
    }
  }
  if (prGateSkipped(dir, opts)) return
  const branch = prGateBranch(dir)
  const snapshots = prGateSnapshots(dir, branch, opts, candidateSha)
  const verdict =
    candidateSha === undefined
      ? evaluateMerged(snapshots, branch, opts.pr)
      : evaluateHarnessCompletion(dir, snapshots, candidateSha, opts)
  if (!verdict.merged) throw prGateRefusal(verdict.detail)
  appendLog(dir, `complete ← PR #${verdict.number} MERGED`)
}

function evaluateHarnessCompletion(
  dir: string,
  snapshots: readonly PrSnapshot[],
  candidateSha: string,
  opts: TaskAdvanceOptions,
): MergedVerdict {
  const policy = resolveEvidenceCompletionPolicy(readRawArbiterConfig(dir), true)
  if (!policy.ok) return { merged: false as const, detail: policy.reason }
  if (policy.policy === 'direct') {
    return { merged: false as const, detail: 'direct completion requires --no-pr.' }
  }
  if (policy.policy === 'legacy') {
    return {
      merged: false as const,
      detail: 'evidenceHarness requires an explicit completion policy.',
    }
  }
  const merged = snapshots.find(
    (pr) =>
      pr.state === 'MERGED' &&
      pr.headRefOid === candidateSha &&
      pr.mergeCommit?.oid &&
      (opts.pr === undefined || pr.number === opts.pr),
  )
  const mergeSha = merged?.mergeCommit?.oid
  const reachable = mergeSha
    ? (opts.isMergeReachable?.(mergeSha, dir) ?? isMergeReachable(mergeSha, dir))
    : false
  return evaluateMerged(snapshots, '', opts.pr, candidateSha, {
    policy: policy.policy,
    mergeReachableFromMain: reachable,
    requireMainBase: true,
  })
}

function isMergeReachable(mergeSha: string, dir: string): boolean {
  try {
    runCli('git', ['merge-base', '--is-ancestor', mergeSha, 'origin/main'], {
      cwd: dir,
      timeoutMs: 15_000,
    })
    return true
  } catch {
    return false
  }
}

function checkCompletionEvidence(dir: string): string | undefined {
  // loadConfig throws for malformed/unreadable config; absence alone is optional.
  const config = loadConfig(dir)
  if (config?.features.evidenceHarness !== true) {
    checkGatePassMarkerGate(dir)
    return undefined
  }
  const taskId = readTaskId(dir)
  if (!taskId) throw new Error('done receipt requires the current task id')
  const verdict = verifyDoneEvidenceReceipt({
    root: dir,
    taskId,
    archetype: config.archetype ?? 'library',
    maxAgeMin: getNumberFlag('ARBITER_EVIDENCE_MAX_AGE_MIN'),
  })
  if (!verdict.ok) throw new Error(verdict.reason)
  return runCli('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 15_000 }).stdout.trim()
}

function checkEvidenceCompletionPreflight(dir: string): void {
  const config = loadConfig(dir)
  if (config?.features.evidenceHarness !== true) return
  const policy = resolveEvidenceCompletionPolicy(readRawArbiterConfig(dir), true)
  if (!policy.ok) throw new Error(`completion policy: ${policy.reason}`)
}

function checkDeliveryContractPreflight(dir: string): void {
  if (loadConfig(dir)?.features.evidenceHarness !== true) return
  if (!isShipTreatment(readUnifiedState(dir)?.treatment)) {
    throw new Error(
      'delivery contract preflight: state writer did not persist a supported ship treatment',
    )
  }
  for (const scriptName of ['record-agent-return.mjs', 'check-review-completion.mjs']) {
    if (!existsSync(join(dir, 'scripts', scriptName))) {
      throw new Error(`delivery contract preflight: missing canonical guard scripts/${scriptName}`)
    }
  }
}

function readRawArbiterConfig(dir: string): unknown {
  try {
    return JSON.parse(readFileTranslated(join(dir, 'arbiter.json'), 'utf-8'))
  } catch (err) {
    throw new Error(
      `completion policy cannot read raw arbiter.json: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}

type EvidenceCompletionPolicy = 'exact-pr' | 'reviewed-pr' | 'direct' | 'legacy'
type EvidenceCompletionPolicyResolution =
  { ok: true; policy: EvidenceCompletionPolicy } | { ok: false; reason: string }

function hasRawGitHubPermission(rawConfig: unknown): boolean {
  return isRecord(rawConfig) && rawConfig['permitGitHub'] === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function policyRefusal(reason: string): EvidenceCompletionPolicyResolution {
  return { ok: false, reason }
}

function resolveExplicitCompletionPolicy(rawConfig: unknown): EvidenceCompletionPolicyResolution {
  if (!isRecord(rawConfig))
    return policyRefusal('completion policy requires an object arbiter.json')
  const policy = explicitPolicy(rawConfig)
  if (policy === undefined)
    return policyRefusal(
      'completion policy requires an explicit supported collaborationMode and merge mode',
    )
  return hasRawGitHubPermission(rawConfig)
    ? { ok: true, policy }
    : policyRefusal('completion requires raw permitGitHub: true')
}

function explicitPolicy(rawConfig: Record<string, unknown>): EvidenceCompletionPolicy | undefined {
  const mode = rawConfig['collaborationMode']
  if (mode === 'peer-review' || mode === 'gated-review') return 'reviewed-pr'
  if (mode !== 'trunk-solo' || !isRecord(rawConfig['solo'])) return undefined
  const mergeMode = rawConfig['solo']['mergeMode']
  if (mergeMode === 'direct') return 'direct'
  return mergeMode === 'pr-ff' ? 'exact-pr' : undefined
}

function resolveEvidenceCompletionPolicy(
  rawConfig: unknown,
  requireExplicit = false,
): EvidenceCompletionPolicyResolution {
  if (!isRecord(rawConfig))
    return policyRefusal('completion policy requires an object arbiter.json')
  const features = rawConfig['features']
  if (!isRecord(features))
    return policyRefusal('completion policy requires an object features config')
  if (!requireExplicit && features['evidenceHarness'] !== true)
    return { ok: true, policy: 'legacy' }
  return resolveExplicitCompletionPolicy(rawConfig)
}

function resolveDirectCompletionPolicy(rawConfig: unknown): EvidenceCompletionPolicyResolution {
  const policy = resolveExplicitCompletionPolicy(rawConfig)
  if (!policy.ok) return policy
  return policy.policy === 'direct'
    ? policy
    : policyRefusal('`--no-pr` requires raw trunk-solo with solo.mergeMode direct')
}

function successfulPostMainCi(checks: NonNullable<PrSnapshot['statusCheckRollup']>): boolean {
  return (
    checks.every(isSuccessfulPostMainCheck) &&
    checks.some((check) => check.conclusion === 'SUCCESS')
  )
}

function isSuccessfulPostMainCheck(
  check: NonNullable<PrSnapshot['statusCheckRollup']>[number],
): boolean {
  const completed = Date.parse(check.completedAt ?? '')
  const outcome = check.conclusion ?? check.state ?? ''
  return (
    check.checkSuite?.branch === 'main' &&
    check.checkSuite.workflowRun?.event === 'push' &&
    Number.isFinite(completed) &&
    completed <= Date.now() &&
    ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(outcome)
  )
}

interface CiPassReceipt {
  sha: string
  conclusion: 'success'
  runUrl: string
  checkedAt: string
}

function localGatePassVerdict(
  dir: string,
  minLevel: string,
): { ok: true } | { ok: false; reason: string } {
  const markerPath = join(dir, '.arbiter', 'gate-pass.json')
  if (!existsSync(markerPath)) {
    return { ok: false, reason: `gate-pass marker missing at ${markerPath}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileTranslated(markerPath, 'utf-8'))
  } catch (err) {
    return {
      ok: false,
      reason: `gate-pass marker corrupt at ${markerPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const verdict = verifyGatePassMarker(parsed, {
    root: dir,
    minLevel,
    maxAgeMin: getNumberFlag('ARBITER_EVIDENCE_MAX_AGE_MIN'),
  })
  return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason }
}

function readCiPassReceipt(dir: string): { ok: true } | { ok: false; reason: string } {
  const receiptPath = join(dir, '.arbiter', 'ci-pass.json')
  if (!existsSync(receiptPath)) {
    return { ok: false, reason: `CI receipt missing at ${receiptPath}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileTranslated(receiptPath, 'utf-8'))
  } catch (err) {
    return {
      ok: false,
      reason: `CI receipt corrupt at ${receiptPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  let head: string
  try {
    head = runCli('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 10_000 }).stdout.trim()
  } catch (err) {
    return {
      ok: false,
      reason: `CI receipt cannot be checked because HEAD could not be resolved: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'CI receipt must be a JSON object' }
  const receipt = parsed as Partial<CiPassReceipt>
  if (receipt.sha !== head) {
    return { ok: false, reason: `CI receipt SHA does not match current HEAD ${head}` }
  }
  if (
    receipt.conclusion !== 'success' ||
    typeof receipt.runUrl !== 'string' ||
    receipt.runUrl.length === 0 ||
    typeof receipt.checkedAt !== 'string' ||
    receipt.checkedAt.length === 0
  ) {
    return { ok: false, reason: 'CI receipt is not a successful, complete receipt' }
  }
  return { ok: true }
}

function checkGatePassMarkerGate(dir: string, minLevel = 'L2'): void {
  const inCi = process.env.CI === 'true'
  const envBypass = getBoolFlag('ARBITER_SKIP_GATE_MARKER')
  if (envBypass && !inCi) {
    // The gate-marker bypass remains explicit and is refused under CI.
    process.stderr.write(
      'WARNING: gate-pass marker gate bypassed (reason=env, ARBITER_SKIP_GATE_MARKER=1)\n',
    )
    return
  }

  const local = localGatePassVerdict(dir, minLevel)
  if (local.ok) return
  const ci = readCiPassReceipt(dir)
  if (ci.ok) return
  throw new Error(
    `${local.reason}; ${ci.reason}. ` +
      'Open a draft PR to start CI, then run `node scripts/ci-receipt.mjs` to record its verdict for HEAD before marking the PR ready.',
  )
}

function reviewHead(dir: string, injected: string | null | undefined): string | null {
  if (injected !== undefined) return injected
  try {
    const sha = runCli('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 5000 }).stdout.trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

function prepareLifecycleReviewRound(
  dir: string,
  opts: TaskReviewRoundOptions,
): PlannedReviewRound | null {
  assertReviewSubjectFrozen(dir)
  const previous = reviewStateOf(readUnifiedState(dir))
  const head = reviewHead(dir, opts.headSha)
  const maxRounds = opts.reviewMaxRounds ?? resolveReviewMaxRounds(shipConfigFor(dir))
  const latestReviewerEnvelope = latestReviewerEnvelopeFor(
    dir,
    readTaskIdFromDisk(dir),
    previous.lastReviewedSha,
  )
  if (head !== null && previous.rounds > 0 && previous.lastReviewedSha === head) {
    if (latestReviewerEnvelope !== undefined || opts.retryIncomplete !== true) return null
    return {
      rounds: previous.rounds,
      maxRounds,
      base: null,
      head,
      forced: previous.forced === true,
    }
  }
  const planned = planReviewRound(
    previous,
    maxRounds,
    head,
    opts.forceReview === true,
    latestReviewerEnvelope,
  )
  if (planned === null) return null
  if ('allowed' in planned) {
    throw new UserFacingError(t('errors.E_REVIEW_ROUNDS_EXHAUSTED', { detail: planned.detail }))
  }
  return planned
}

function reviewerFindings(raw: unknown): ReviewRoundEnvelope['findings'] | null {
  if (!Array.isArray(raw) || !raw.every(isRecord)) return null
  if (
    !raw.every(
      (finding) =>
        typeof finding['id'] === 'string' &&
        ['critical', 'high', 'med', 'low', 'info'].includes(String(finding['severity'])) &&
        typeof finding['kind'] === 'string' &&
        typeof finding['claim'] === 'string' &&
        Array.isArray(finding['citations']),
    )
  ) {
    return null
  }
  const severities = raw.map((finding) => finding['severity'])
  if (!severities.every((severity): severity is string => typeof severity === 'string')) return null
  return severities.map((severity) => ({ severity }))
}

function isReviewerEnvelope(
  parsed: unknown,
  taskId: string,
  frozenSha: string,
): parsed is Record<string, unknown> {
  return (
    isRecord(parsed) &&
    parsed['schema'] === 'arbiter-agent-return-v1' &&
    typeof parsed['agent'] === 'string' &&
    parsed['taskId'] === taskId &&
    parsed['role'] === 'reviewer' &&
    typeof parsed['branch'] === 'string' &&
    parsed['sha'] === frozenSha &&
    typeof parsed['ts'] === 'string' &&
    ['PASS', 'WARN', 'FAIL'].includes(String(parsed['verdict'])) &&
    typeof parsed['confidence'] === 'number'
  )
}

function readReviewerEnvelope(
  path: string,
  taskId: string,
  frozenSha: string,
): ReviewRoundEnvelope | null {
  try {
    if (!lstatSync(path).isFile()) return null
    const parsed: unknown = JSON.parse(readFileTranslated(path, 'utf8'))
    if (!isReviewerEnvelope(parsed, taskId, frozenSha)) return null
    const findings = reviewerFindings(parsed['findings'])
    return findings === null ? null : { sha: frozenSha, findings }
  } catch {
    return null
  }
}

function latestReviewerEnvelopeFor(
  dir: string,
  taskId: string | undefined,
  frozenSha: string | null,
): ReviewRoundEnvelope | undefined {
  if (taskId === undefined || frozenSha === null) return undefined
  const taskDir = join(dir, '.arbiter', 'evidence', 'agent-returns', sanitizeTaskId(taskId))
  let entries: string[]
  try {
    entries = readdirSync(taskDir)
      .filter((entry) => entry.endsWith('.json'))
      .sort()
  } catch {
    return undefined
  }
  const findings: { severity: string }[] = []
  let found = false
  for (const entry of entries) {
    const envelope = readReviewerEnvelope(join(taskDir, entry), taskId, frozenSha)
    if (envelope === null) continue
    found = true
    findings.push(...envelope.findings)
  }
  return found ? { sha: frozenSha, findings } : undefined
}

function assertReviewSubjectFrozen(dir: string): void {
  const plan = readUnifiedState(dir)?.plan.trim().split('#')[0]?.trim() ?? ''
  if (plan.length === 0 || !pathExistsInCommit('HEAD', plan, dir)) {
    throw new Error('review freeze requires a tracked plan present in HEAD')
  }
  const dirty = runCli('git', ['status', '--porcelain'], {
    cwd: dir,
    timeoutMs: 5000,
  }).stdout.trim()
  if (dirty.length > 0) {
    throw new Error('review freeze requires a clean HEAD; commit the plan and every candidate fix')
  }
}

function appendReviewLog(dir: string, plan: PlannedReviewRound): void {
  const at = plan.head === null ? 'an unknown sha' : plan.head.slice(0, 7)
  appendLog(dir, `review → round ${plan.rounds} at ${at}${plan.forced ? ' (forced)' : ''}`)
}

export function runTaskReviewRound(opts: TaskReviewRoundOptions = {}): PlannedReviewRound | null {
  const dir = opts.dir ?? process.cwd()
  assertBoundNativeHost(dir, undefined)
  if (currentPhase(dir) !== 'refactor') {
    throw new Error('review round can only be opened while lifecycle phase is refactor')
  }
  const plan = prepareLifecycleReviewRound(dir, opts)
  if (plan === null) return null
  const previous = reviewStateOf(readUnifiedState(dir))
  const retryingOpenRound =
    opts.retryIncomplete === true &&
    plan.rounds === previous.rounds &&
    plan.head === previous.lastReviewedSha
  if (retryingOpenRound) return plan
  const wasForced = previous.forced === true
  writeUnifiedState(dir, {
    review: {
      rounds: plan.rounds,
      lastReviewedSha: plan.head,
      ...(plan.forced || wasForced ? { forced: true } : {}),
    },
  })
  appendReviewLog(dir, plan)
  return plan
}

function assertNoProgressNotBlocked(dir: string): void {
  const blocked = readUnifiedState(dir)?.treatment?.reasons.some((reason) =>
    reason.startsWith('BLOCKED:'),
  )
  if (blocked === true) throw new UserFacingError(t('errors.E_NO_PROGRESS_BLOCKED'))
}

function assertPhaseTransition(
  current: TaskPhase,
  target: TaskPhase,
  reverse: boolean | undefined,
): void {
  const isLateralTarget = (LATERAL_PHASES as readonly string[]).includes(target)
  const isLateralCurrent = (LATERAL_PHASES as readonly string[]).includes(current)
  if (isLateralTarget || isLateralCurrent) return

  const currentIdx = PHASE_ORDER.indexOf(current)
  const targetIdx = PHASE_ORDER.indexOf(target)
  if (targetIdx < currentIdx && !reverse) {
    throw new Error(
      `Backward transition "${current}" → "${target}" blocked. Use --reverse to allow backward transitions.`,
    )
  }
  if (targetIdx > currentIdx + 1) {
    throw new Error(
      `Illegal skip: cannot advance from "${current}" to "${target}" (missing intermediate phases). Advance one phase at a time.`,
    )
  }
}

export function runTaskAdvance(opts: TaskAdvanceOptions): PlannedReviewRound | null {
  const dir = opts.dir ?? process.cwd()
  const claudeDir = join(dir, '.claude')
  const { to } = opts

  assertBoundNativeHost(dir, undefined)

  if (!isValidPhase(to)) {
    throw new Error(
      `Invalid --to value: "${String(to)}". Valid phases: ${[...PHASE_ORDER, ...LATERAL_PHASES].join(', ')}`,
    )
  }

  assertNoProgressNotBlocked(dir)

  const current = currentPhase(dir)

  if (current === to) return null
  assertPhaseTransition(current, to, opts.reverse)

  // Each transition enforces only the proof due at this point in the lifecycle.
  const phaseGates: Partial<Record<TaskPhase, () => void>> = {
    plan: () => {
      checkTaskSeededGate(dir)
      checkEvidenceCompletionPreflight(dir)
      checkDeliveryContractPreflight(dir)
    },
    red: () => {
      checkTaskSeededGate(dir)
      checkAcceptancePlanGate(dir)
    },
    green: () => {
      checkTddEvidenceGate(dir, claudeDir)
    },
    refactor: () => {
      // Entering `refactor` prepares review without spending a round. The reconciliation — both key on the task id, and `check-review-completion.mjs`
      // vacuous-passes when that id is unavailable. An id-less document therefore disarms
      // the very gate this phase's ship.md row promises, so it is refused here.
      checkTaskSeededGate(dir)
      checkGreenExecutionGate(dir)
    },
    verification: () => {
      checkChainTddEvidenceGate(dir)
      checkTddEvidenceProvenanceGate(dir)
      checkReviewCompletionGate(dir)
      checkAcceptanceFitGate(dir)
    },
    close: () => {
      checkGatePassMarkerGate(dir, 'L1')
    },
    complete: () => {
      // Marker first: it is the cheap local check, and the pre-existing gate-level contract must
      // keep failing before the network-touching PR verification runs.
      const candidateSha = checkCompletionEvidence(dir)
      checkPrMergedGate(dir, opts, candidateSha)
    },
  }
  phaseGates[to]?.()
  // Phase entry never spends a review round. Only an explicit reviewer dispatch does.
  writeUnifiedState(dir, { phase: to })
  appendLog(dir, `${current} → ${to}`)
  return null
}

/**
 * Admission guard for the existing Markdown acceptance contract (INV-138).
 * The emitted checker owns feature/profile semantics; this native phase gate only supplies the
 * anchored plan and runs before any other red-entry work or the authoritative state write.
 */
function checkAcceptancePlanGate(dir: string): void {
  if (!acceptanceProfileEnabled(dir)) return
  const script = join(dir, 'scripts', 'check-acceptance.mjs')
  if (!existsSync(script)) {
    throw new Error(
      `acceptance-anchor gate: profile is enabled but ${script} is missing. ` +
        'Restore the emitted checker before entering red.',
    )
  }

  const state = readUnifiedState(dir)
  const plan = state?.plan.trim() ?? ''
  const taskIds = acceptanceTaskIds(state)
  if (taskIds.length === 0)
    throw new Error('acceptance-anchor gate requires the active task or chain issue id')
  try {
    for (const taskId of new Set(taskIds)) {
      runCli('node', [script, ...admissionArgsForTask(taskId, plan)], {
        cwd: dir,
        timeoutMs: 5000,
      })
    }
  } catch (err) {
    throw new Error(
      `acceptance-anchor gate: ${err instanceof Error ? err.message : String(err)}. ` +
        'The red phase was not entered; restore the emitted checker or repair the anchored Markdown plan.',
      { cause: err },
    )
  }
}

function acceptanceTaskIds(state: UnifiedTaskState | null): string[] {
  return [state?.taskId, ...(state?.chainIds ?? [])].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
}

function admissionArgsForTask(taskId: string, plan: string): string[] {
  const issueNumber = taskId.replace(/^#/, '')
  const args = ['--plan', plan]
  if (/^\d+$/.test(issueNumber)) args.push('--admit-issue', issueNumber)
  else
    process.stdout.write(
      `SKIP issue-coverage admission: task id ${taskId} is not a GitHub issue number\n`,
    )
  return args
}

function runRequiredTaskChecker(dir: string, scriptName: string, args: readonly string[]): void {
  const script = join(dir, 'scripts', scriptName)
  if (!existsSync(script)) {
    throw new Error(`${scriptName} is required by the active delivery profile but is missing`)
  }
  try {
    runCli('node', [script, ...args], { cwd: dir, timeoutMs: 30_000 })
  } catch (err) {
    throw new Error(
      `${scriptName} blocked the lifecycle transition: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}

function checkReviewCompletionGate(dir: string): void {
  if (loadConfig(dir)?.features.evidenceHarness !== true) return
  const taskId = readTaskIdFromDisk(dir)
  if (!taskId) throw new Error('review completion requires the current task id')
  runRequiredTaskChecker(dir, 'check-review-completion.mjs', ['--task', taskId])
}

function checkAcceptanceFitGate(dir: string): void {
  if (!acceptanceProfileEnabled(dir)) return
  const state = readUnifiedState(dir)
  const taskId = state?.taskId
  const plan = state?.plan.trim()
  if (!taskId || !plan) throw new Error('acceptance fit requires the current task id and plan')
  const fit = join('.arbiter', 'evidence', 'ac-fit', `${taskId.replace(/[^0-9A-Za-z-]/g, '')}.json`)
  runRequiredTaskChecker(dir, 'check-acceptance.mjs', ['--plan', plan, '--ac-fit', fit])
}

/** Match the emitted checker's lightweight profile resolution before deciding whether a missing checker is optional. */
function acceptanceProfileEnabled(dir: string): boolean {
  const override = process.env.ARBITER_ACCEPTANCE_ANCHOR
  // Keep parity with scripts/check-acceptance.mjs: only its documented 1/true/0/false
  // spellings override the file; other values fall through to arbiter.json.
  if (override === '1' || override === 'true' || override === '0' || override === 'false') {
    return getBoolFlag('ARBITER_ACCEPTANCE_ANCHOR')
  }
  try {
    const config = JSON.parse(readFileTranslated(join(dir, 'arbiter.json'), 'utf-8')) as {
      features?: { acceptanceAnchor?: boolean }
    }
    return config.features?.acceptanceAnchor === true
  } catch {
    return false
  }
}

function checkTddEvidenceGate(dir: string, claudeDir: string): void {
  assertTddEvidenceFor(readTaskIdFromDisk(dir) ?? 'unknown', dir)
  void claudeDir
}

function checkGreenExecutionGate(dir: string): void {
  const taskId = readTaskIdFromDisk(dir) ?? 'unknown'
  assertTddEvidenceFor(taskId, dir)
  const evidence = loadTddEvidence(taskId, dir)
  if (!evidence.ok) throw new Error(`GREEN execution gate: ${evidence.reason}`)
  const result = verifyGreenExecution(evidence.data, dir)
  if (!result.ok) {
    throw new Error(`GREEN execution gate: ${result.reason ?? 'recorded RED test did not pass'}`)
  }
}

/**
 * #2435 — `preflight` promises "Seed task state"; without a task id every downstream gate
 * degrades to a vacuous pass (evidence has no id to key on) and `task get` reports whatever
 * the previous task left at the fixed status path. Refusing the preflight → plan edge is the
 * cheapest place to make that promise real.
 */
function checkTaskSeededGate(dir: string): void {
  const taskId = readTaskIdFromDisk(dir)
  if (taskId !== undefined && taskId.trim().length > 0) return
  throw new Error(
    'task-seed gate: no task id in .claude/.task/status.json — `preflight` promises seeded ' +
      'task state, and every later evidence gate keys on that id. ' +
      'Run `arbiter lifecycle start --id <id> --tier <tier>` first.',
  )
}

/**
 * #2331 — every issue on a chain owes RED evidence, not just the primary.
 *
 * `--chain` (#2102) lands N issues through ONE worktree, gate and PR, but the evidence gate only
 * ever verified the single active id, so N−1 issues shipped with nothing asserting a test failed
 * for them first. This is the evidence peer of the per-id commit-subject scan `.githooks/pre-push`
 * already performs.
 *
 * It runs at `verification`, NOT at `green`: a chain traverses the phase machine once, so at
 * `green` only the primary is implemented and demanding the whole chain would deadlock every
 * train at its first issue.
 *
 * Reports every missing id at once — an operator fixing a train wants the whole list, not one
 * failure per re-run.
 */
function checkChainTddEvidenceGate(dir: string): void {
  const chainIds = readUnifiedState(dir)?.chainIds ?? []
  if (chainIds.length === 0) return

  const failures: string[] = []
  for (const id of chainIds) {
    try {
      assertTddEvidenceFor(id, dir)
    } catch (err) {
      failures.push(`  ${id}: ${(err as Error).message}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Chain TDD evidence gate: ${failures.length} of ${chainIds.length} chained issue(s) ` +
        `lack valid RED evidence.\n${failures.join('\n')}\n` +
        `Every issue batched onto this branch must have failed a test before it was implemented.`,
    )
  }
}

/**
 * Require committed, branch-produced receipts before verification. Content validation remains in
 * assertTddEvidenceFor; this second axis prevents an untracked/staged or main-inherited receipt
 * from satisfying the phase contract. The primary is included because recovery can enter
 * verification without re-running the green entry gate.
 */
function checkTddEvidenceProvenanceGate(dir: string): void {
  const state = readUnifiedState(dir)
  const primary = state?.taskId ?? 'unknown'
  const ids = [primary, ...(state?.chainIds ?? [])]
  const failures: string[] = []
  try {
    // The chain sweep above covers every chained id; repeat the primary here so recovery cannot
    // enter verification with a committed-but-invalid primary receipt.
    assertTddEvidenceFor(primary, dir)
  } catch (err) {
    failures.push(`  ${primary}: ${(err as Error).message}`)
  }
  for (const id of ids) {
    if (!tddEvidenceProducedOnBranch(id, dir)) {
      failures.push(`  ${id}: receipt is not committed on this branch`)
    }
  }
  if (failures.length === 0) return
  throw new Error(
    `TDD evidence provenance gate: ${failures.length} failure(s) before verification:\n` +
      `${failures.join('\n')}\n` +
      'Receipts must be committed and produced on this branch after origin/main. ' +
      'Commit the real RED evidence before entering verification.',
  )
}

/** Validate the RED evidence for ONE issue id. Shared by the primary and chain gates. */
function assertTddEvidenceFor(rawId: string, dir: string): void {
  const result = loadTddEvidence(rawId, dir)
  if (!result.ok) {
    throw new Error(
      `TDD evidence gate: ${result.reason}. ` +
        `Run \`arbiter lifecycle record-red --test-path <path>\` to capture failing test evidence first.`,
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

  // #2116: resolve through the rebase-stable blob pin — a rebased branch keeps the RED
  // test's content even though every commit sha on it was rewritten.
  const resolved = resolveEvidenceCommit(ev, dir)
  if (resolved === null) {
    throw new Error(
      `TDD evidence gate: test_commit_sha "${ev.test_commit_sha}" is not reachable from HEAD. ` +
        `Ensure the test was committed before running \`arbiter lifecycle record-red\`, or re-record ` +
        `the evidence after a rebase.`,
    )
  }
  if ('degraded' in resolved) {
    throw new Error(`TDD evidence gate: ${resolved.reason}`)
  }

  if (!pathExistsInCommit(resolved.sha, ev.test_path, dir)) {
    throw new Error(
      `TDD evidence gate: test_path "${ev.test_path}" not found in commit ${resolved.sha}. ` +
        `Verify the test file was committed at that sha.`,
    )
  }
}
