// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDir, writeFileTranslated, readFileTranslated } from '../utils/fs.js'
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
} from './task-state.js'
import { runCli, type RunCliResult } from '../utils/run-cli.js'
import { evaluateMerged, type MergedVerdict, type PrSnapshot } from './pr-merged.js'
import { shipConfigFor, permitsGitHubCalls } from './ship-config.js'
import { evaluateSeedSize, resolveTrainLimits } from './ship-train.js'
import { UserFacingError } from '../utils/errors.js'
import { t } from '../i18n/index.js'
import { loadTddEvidence, extractFailureSignature } from '../evidence/tdd.js'
import {
  pathExistsInCommit,
  resolveEvidenceCommit,
  tddEvidenceProducedOnBranch,
} from '../evidence/git-checks.js'
import { detectHostCapabilities } from '../capabilities/host-probe.js'
import { loadConfig } from '../utils/config.js'
import { verifyGatePassMarker, verifyDoneEvidenceReceipt } from '../evidence/gate-binding.js'

export class HandoffRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HandoffRequiredError'
  }
}

// Task-state vocabulary and the unified-document I/O live in `./task-state.ts`.
// Re-export the phase types here so existing importers (e.g. src/cli.ts) keep their import path.
export type { TaskPhase } from './task-state.js'

export interface TaskAdvanceOptions {
  to: TaskPhase
  dir?: string
  reverse?: boolean
  /** Bypass the plan-review gate when target is red. Writes an audit record. */
  skipPlanReview?: boolean
  /** Signal that this invocation is post-/clear (equivalent to ARBITER_POST_CLEAR=1). */
  postClear?: boolean
  /** Caller-supplied implementation unit count; drives the clear-strategy decision.
   *  When absent, falls back to the tier's conservative default (→ 'stop'). */
  units?: number
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
    'Phase: verification\nAction: Gate running. Re-run: node scripts/check-all.mjs L2\nNext: Fix any failures, then arbiter task advance --to close.',
  close:
    'Phase: close\nAction: CLOSER mode active — see .claude/rules/95-closer-mode.md. Single named target, no new issues/refactor beyond the diff (findings → PARKING), no gate-appeasement deletions. Same error twice → 5-line root-cause or declare BLOCKED.\nNext: Commit, push, open/land the PR; foreground-wait on its checks. Merged + evidence → arbiter task advance --to complete.',
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
  /** #2102 — `--chain <id>` (repeatable): other issue ids batched into this task's worktree. */
  chainIds?: string[]
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
  // #2102 — rejects a non-numeric id the same way `arbiter ship`'s primary-id normalizer does,
  // so a chain id can never silently fail the pre-push `#<id>` commit-message scan it feeds.
  if (opts.chainIds !== undefined) patch.chainIds = opts.chainIds.map(normalizeChainId)
  // #2402 — the SAME train bound `arbiter ship` enforces. This writer had none, so
  // `task init 1 2 ... 15` seeded a train no limit ever saw while `ship` refused the identical
  // request; the positional-id sugar made that a one-line typo rather than fifteen flags.
  assertSeedWithinTrainLimit(root, opts.id, patch.chainIds)
  const branch = detectCurrentBranch(root)
  if (branch !== undefined) patch.branch = branch
  const state = writeUnifiedState(root, patch)
  appendLog(root, `init task ${state.taskId || '(unset)'} tier=${state.tier || '(unset)'}`)
}

/**
 * #2402 — refuse a `task init` that would seed a train past `ship.train.maxChain`. Shares the
 * verdict with `arbiter ship`'s seed check (`evaluateSeedSize`) so the two writers of `chainIds`
 * cannot disagree about the bound.
 */
function assertSeedWithinTrainLimit(
  root: string,
  taskId: string | undefined,
  chainIds: readonly string[] | undefined,
): void {
  const verdict = evaluateSeedSize(
    readUnifiedState(root),
    taskId,
    chainIds,
    resolveTrainLimits(shipConfigFor(root)),
  )
  if (verdict.ok) return
  const seal = { reason: 'max-chain' as const, detail: verdict.detail }
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

const GETTABLE_FIELDS = ['phase', 'taskId', 'tier', 'plan', 'tddPhase', 'lastAction', 'nextAction']

export interface TaskGetOptions {
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
      `The value below belongs to that other task. Run \`arbiter task init --id <id>\` to seed this one.\n`,
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
      reason: `no plan-review evidence at ${latestPath} — record a PASS verdict there first`,
    }
  }
  let parsed: LatestJson
  try {
    parsed = JSON.parse(readFileTranslated(latestPath, 'utf-8')) as LatestJson
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
        reason: 'plan changed since last review — re-review and update latest.json',
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
  ensureDir(evDir)
  const ts = new Date().toISOString()
  const record = {
    reason,
    git_user: readGitUserName(),
    ts,
  }
  writeFileTranslated(
    join(evDir, `bypass-${ts.replace(/[:.]/g, '-')}.json`),
    JSON.stringify(record, null, 2),
  )
}

function loadPlanContentIfAvailable(dir: string): string | undefined {
  const planPath = readUnifiedState(dir)?.plan.trim()
  if (!planPath || planPath.length === 0) return undefined
  const resolved = join(dir, planPath)
  const candidate = existsSync(planPath) ? planPath : existsSync(resolved) ? resolved : undefined
  if (candidate === undefined) return undefined
  return readFileTranslated(candidate, 'utf-8')
}

function checkPlanReviewGate(dir: string, claudeDir: string, opts: TaskAdvanceOptions): void {
  if (!gateEnabled(dir)) return
  const rawId = readTaskIdFromDisk(dir) ?? 'unknown'
  const sanit = sanitizeTaskId(rawId)
  const inCi = process.env.CI === 'true'
  const envBypass = getBoolFlag('ARBITER_SKIP_PLAN_REVIEW')

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
        ... on CheckRun { name conclusion completedAt checkSuite { createdAt branch workflowRun { event } } }
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
            nodes: NonNullable<PrSnapshot['statusCheckRollup']>
            pageInfo: { hasNextPage: boolean }
          }
        }
      }
    }
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
  return contexts.flatMap((page) => page.nodes)
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

function checkGatePassMarkerGate(dir: string, minLevel = 'L2'): void {
  const inCi = process.env.CI === 'true'
  const envBypass = getBoolFlag('ARBITER_SKIP_GATE_MARKER')
  if (envBypass && !inCi) {
    // writeBypassRecord is intentionally plan-review-specific in both path and record shape.
    process.stderr.write(
      'WARNING: gate-pass marker gate bypassed (reason=env, ARBITER_SKIP_GATE_MARKER=1)\n',
    )
    return
  }

  const markerPath = join(dir, '.arbiter', 'gate-pass.json')
  if (!existsSync(markerPath)) {
    throw new Error(
      `gate-pass marker missing at ${markerPath}. Run \`node scripts/check-all.mjs ${minLevel}\` first.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileTranslated(markerPath, 'utf-8'))
  } catch (err) {
    throw new Error(
      `gate-pass marker corrupt at ${markerPath}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Run \`node scripts/check-all.mjs ${minLevel}\` first.`,
      { cause: err },
    )
  }

  const verdict = verifyGatePassMarker(parsed, {
    root: dir,
    minLevel,
    maxAgeMin: getNumberFlag('ARBITER_EVIDENCE_MAX_AGE_MIN'),
  })
  if (!verdict.ok) {
    throw new Error(`${verdict.reason}. Run \`node scripts/check-all.mjs ${minLevel}\` again.`)
  }
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
  // #2435 — the gate for a phase runs on ENTRY, so the promise `.claude/commands/ship.md`
  // makes for phase P is asserted by the entry gate of the phase P is left FOR. Every row
  // of that table promising a dispatch or an evidence artifact (`plan`, `red-team-review`,
  // `refactor`) now owns an entry here; five of ten phases previously asserted nothing, so
  // a ship could reach `verification` with no plan reviewed and no red team ever dispatched.
  // `__tests__/docs/ship-phase-gates-2435.test.ts` derives that expectation from ship.md.
  const phaseGates: Partial<Record<TaskPhase, () => void>> = {
    plan: () => {
      checkTaskSeededGate(dir)
      checkEvidenceCompletionPreflight(dir)
    },
    'red-team-review': () => {
      // Leaving `plan`: its row promises a plan-review dispatch writing a PASS verdict.
      // The same assertion already guarded the plan → red edge; it now guards every exit.
      checkPlanReviewGate(dir, claudeDir, opts)
    },
    'red-team-rework': () => {
      checkRedTeamEvidenceGate(dir, current, PLANNING_PHASES)
    },
    red: () => {
      checkAcceptancePlanGate(dir)
      checkPlanReviewGate(dir, claudeDir, opts)
      checkRedTeamEvidenceGate(dir, current, PLANNING_PHASES)
      if (PLANNING_PHASES.has(current)) {
        checkHandoffGate(dir, claudeDir, opts)
      }
    },
    green: () => {
      checkTddEvidenceGate(dir, claudeDir)
    },
    refactor: () => {
      // Entering `refactor` opens review round 1 and arms the review-completion
      // reconciliation — both key on the task id, and `check-review-completion.mjs`
      // vacuous-passes when that id is unavailable. An id-less document therefore disarms
      // the very gate this phase's ship.md row promises, so it is refused here.
      checkTaskSeededGate(dir)
    },
    verification: () => {
      checkChainTddEvidenceGate(dir)
      checkTddEvidenceProvenanceGate(dir)
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

  // Single authoritative write: phase advances in the unified document; the transition is
  // recorded in the append-only log. Gates that throw (handoff) run BEFORE this and never
  // mutate the phase — see checkHandoffGate (C1, #1206).
  writeUnifiedState(dir, { phase: to })
  appendLog(dir, `${current} → ${to}`)
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

  const plan = readUnifiedState(dir)?.plan.trim() ?? ''
  try {
    runCli('node', [script, '--plan', plan], { cwd: dir, timeoutMs: 5000 })
  } catch (err) {
    throw new Error(
      `acceptance-anchor gate: ${err instanceof Error ? err.message : String(err)}. ` +
        'The red phase was not entered; restore the emitted checker or repair the anchored Markdown plan.',
      { cause: err },
    )
  }
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
      'Run `arbiter task init --id <id> --tier <tier>` first.',
  )
}

/**
 * #2435 — `.claude/commands/ship.md` promises the `red-team-review` phase dispatches tier-N
 * red-team agents and records them at `.arbiter/evidence/redteam/<task-id>.json`. Nothing
 * asserted it, so `arbiter task advance --to red` succeeded with no red team ever run.
 *
 * Scoped to the exits FROM a red-team phase: entering `red` straight from `plan` is not a
 * path the red-team promise covers.
 */
function checkRedTeamEvidenceGate(
  dir: string,
  current: TaskPhase,
  planningPhases: ReadonlySet<TaskPhase>,
): void {
  if (!planningPhases.has(current)) return
  const taskId = readTaskIdFromDisk(dir) ?? 'unknown'
  const path = join(dir, '.arbiter', 'evidence', 'redteam', `${taskId}.json`)
  if (existsSync(path)) return
  throw new Error(
    `red-team evidence gate: no red-team evidence at ${path}. ` +
      'The `red-team-review` phase dispatches tier-N red-team agents and records their ' +
      'findings there (see .claude/commands/ship.md §Red-team review) — record it before advancing.',
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

  // #2116: resolve through the rebase-stable blob pin — a rebased branch keeps the RED
  // test's content even though every commit sha on it was rewritten.
  const resolved = resolveEvidenceCommit(ev, dir)
  if (resolved === null) {
    throw new Error(
      `TDD evidence gate: test_commit_sha "${ev.test_commit_sha}" is not reachable from HEAD. ` +
        `Ensure the test was committed before running \`arbiter task record-red\`, or re-record ` +
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
    `Flag: --post-clear signals post-/clear re-entry (marks task state resumed).`,
  ].join('\n')
}

function handlePostClearReEntry(rawId: string, dir: string): void {
  const existing: Partial<UnifiedTaskState> = readUnifiedState(dir) ?? {}

  // Fast path: already fully resumed — this call is a no-op.
  if (existing.postClearResumed !== undefined) return

  // Resolve the canonical task id. Prefer the one persisted in state (authoritative) over the
  // raw id from disk which may be 'unknown' if state was not initialized yet.
  const taskId = existing.taskId || (rawId !== 'unknown' ? rawId : undefined)
  if (!taskId) {
    throw new Error(
      `Post-clear re-entry: task state has no taskId. ` +
        `Re-initialize the task with \`arbiter task init --id #NNN\` before resuming. ` +
        `(rawId="${rawId}", existing.taskId="${existing.taskId ?? ''}")`,
    )
  }

  // Metadata only — never the phase. runTaskAdvance writes phase:'red' AFTER this returns.
  writeUnifiedState(dir, { postClearResumed: new Date().toISOString() })
}

function checkHandoffGate(dir: string, claudeDir: string, opts: TaskAdvanceOptions): void {
  void claudeDir
  const rawId = readTaskIdFromDisk(dir) ?? 'unknown'

  const isPostClear = opts.postClear === true || getBoolFlag('ARBITER_POST_CLEAR')

  if (isPostClear) {
    handlePostClearReEntry(rawId, dir)
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
