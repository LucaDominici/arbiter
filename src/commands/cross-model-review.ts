// SPDX-License-Identifier: Apache-2.0
// #2357 — the /ship-facing boundary for the optional external review seat.
import { join, resolve } from 'node:path'
import { detectExternalModel, type ExternalModelAccess } from '../detectors/external-model.js'
import {
  assertSafeArbiterEvidenceRoot,
  invokeExternalReview,
} from '../integrations/external-review.js'
import { resolveShipProfile } from './ship-profile.js'
import { normTier, type ShipTier, type ShipTreatment } from './ship-tier.js'
import type { TaskPhase } from './task-state.js'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { readFileContained, toFsError, writeFileContained } from '../utils/fs.js'
import { runCli } from '../utils/run-cli.js'
import type { CrossModelReviewConfig } from '../wizard/types.js'
import { currentBranch, headSha } from '../evidence/git-checks.js'

const CODEX_REVIEWER_PROVENANCE = {
  vendor: 'openai',
  dispatch: 'external-cli',
  cli: 'codex',
} as const

interface CrossModelReviewCommandOptions {
  taskId: string
  prompt: string
  diff?: string
  dir?: string
  tier?: string
  phase?: TaskPhase
  vertical?: string
}

/** Run the configured Codex seat; the diff defaults to stdin so it never enters argv. */
function runCrossModelReview(
  options: CrossModelReviewCommandOptions,
): ReturnType<typeof invokeExternalReview> {
  const repoRoot = resolve(options.dir ?? process.cwd())
  const tier = normTier(options.tier)
  const profile = resolveShipProfile(repoRoot)
  const cfg = profile.crossModelReview
  if (!cfg?.enabled) {
    throw new Error('crossModelReview.enabled must be true to run an external review')
  }
  if (!cfg.diffEgressConsent) {
    throw new Error('crossModelReview.diffEgressConsent must be true to send the diff')
  }
  const result = invokeExternalReview({
    repoRoot,
    taskId: options.taskId,
    prompt: options.prompt,
    diff: options.diff ?? readStdin(),
    cfg,
    access: detectExternalModel('codex'),
    tier,
    phase: options.phase ?? 'refactor',
    vertical: options.vertical ?? 'bugs',
  })
  if (existsSync(repoRoot))
    writeExternalReviewSidecar({
      repoRoot,
      taskId: options.taskId,
      result,
      tier,
      collaborationMode: profile.collaborationMode,
    })
  return result
}

interface ShipCrossModelReviewOptions {
  dir: string
  taskId: string
  tier: ShipTier
  phase: TaskPhase
  vertical: string
  cfg: CrossModelReviewConfig
  collaborationMode?: 'trunk-solo' | 'peer-review' | 'gated-review'
  access?: ExternalModelAccess
  /** Frozen review base; omitted keeps the legacy origin/main diff. */
  baseSha?: string | null
  /** Exact candidate commit and tracked plan used to construct the reviewer brief. */
  headSha: string | null
  planRef: string
  /** Active treatment, when the runtime owns this review round. */
  treatment?: Pick<ShipTreatment, 'finalReviewers' | 'reviewerVerticals' | 'signalsHash'>
}

type ReviewSidecar = {
  count?: unknown
  agents?: unknown
  branch?: unknown
  sha?: unknown
  taskId?: unknown
  expectedProvenance?: unknown
  auditors?: unknown
  treatmentHash?: unknown
}

function isRecord(value: unknown): value is ReviewSidecar {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSafeSidecarFile(path: string): void {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`${path} must not be a symbolic link`)
    if (!stat.isFile()) throw new Error(`${path} must be a regular file`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw toFsError(error, path)
  }
}

function readSidecar(repoRoot: string): ReviewSidecar | null {
  const relativePath = join('.arbiter', 'agents-dispatched.json')
  const path = join(repoRoot, '.arbiter', 'agents-dispatched.json')
  try {
    assertSafeArbiterEvidenceRoot(repoRoot)
    assertSafeSidecarFile(path)
    if (!existsSync(path)) return null
    const parsed: unknown = JSON.parse(readFileContained(repoRoot, relativePath))
    if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`cannot read dispatch sidecar ${path}: ${String(error)}`, { cause: error })
  }
}

function isCurrentSidecar(
  existing: ReviewSidecar | null,
  branch: string,
  sha: string,
  taskId: string,
): existing is ReviewSidecar {
  return (
    existing !== null &&
    existing.branch === branch &&
    existing.sha === sha &&
    existing.taskId === taskId
  )
}

function hasCurrentFulfilledReview(repoRoot: string, taskId: string): boolean {
  if (!existsSync(join(repoRoot, '.git'))) return false
  const branch = currentBranch(repoRoot)
  const sha = headSha(repoRoot)
  if (branch === 'unknown' || sha === 'unknown') return false
  const sidecar = readSidecar(repoRoot)
  if (!(
    isCurrentSidecar(sidecar, branch, sha, taskId) &&
    Array.isArray(sidecar.agents) &&
    sidecar.agents.includes('codex-reviewer')
  ))
    return false
  try {
    return (
      runCli(
        'node',
        [join(repoRoot, 'scripts', 'check-cross-model-review.mjs'), '--require-fulfilled'],
        {
          cwd: repoRoot,
          timeoutMs: 5_000,
          retries: 0,
        },
      ).exitCode === 0
    )
    // FAIL-OPEN-INTENT: stale or unavailable fulfilment evidence is a cache miss; rerun review.
  } catch {
    return false
  }
}

function readSidecarAgents(existing: ReviewSidecar): string[] | null {
  if (existing.agents === undefined) return null
  if (
    !Array.isArray(existing.agents) ||
    !existing.agents.every((agent) => typeof agent === 'string')
  ) {
    throw new Error('existing dispatch sidecar has invalid agent names')
  }
  const agents = [...existing.agents]
  if (new Set(agents).size !== agents.length)
    throw new Error('existing dispatch sidecar has duplicate agents')
  if (
    existing.count !== undefined &&
    (typeof existing.count !== 'number' ||
      !Number.isInteger(existing.count) ||
      existing.count < 0 ||
      existing.count > agents.length)
  ) {
    throw new Error('existing dispatch sidecar has an invalid count')
  }
  return agents
}

function freshReviewPanel(context: {
  tier: ShipTier
  collaborationMode: 'trunk-solo' | 'peer-review' | 'gated-review'
}): { count: number; agents: string[] } {
  const peerStandard = context.collaborationMode !== 'trunk-solo' && context.tier === 'Standard'
  return peerStandard
    ? { count: 2, agents: ['anthropic-reviewer', 'codex-reviewer'] }
    : { count: 1, agents: ['codex-reviewer'] }
}

function completeReviewPanel(agents: string[], panelSize: number): string[] {
  if (panelSize !== 2 || agents.length !== 1) return agents
  const first = agents[0] ?? 'anthropic-reviewer'
  return [first === 'codex-reviewer' ? 'anthropic-reviewer' : first, 'codex-reviewer']
}

function sidecarAgents(
  existing: ReviewSidecar | null,
  branch: string,
  sha: string,
  taskId: string,
  context: {
    tier: ShipTier
    collaborationMode: 'trunk-solo' | 'peer-review' | 'gated-review'
  },
): { count: number; agents: string[] } {
  const fresh = freshReviewPanel(context)
  if (!isCurrentSidecar(existing, branch, sha, taskId)) return fresh
  const agents = readSidecarAgents(existing)
  if (agents === null) return fresh
  if (agents.length === 0) return fresh
  const completed = completeReviewPanel(agents, fresh.count)
  if (completed !== agents) return { count: completed.length, agents: completed }
  if (!agents.includes('codex-reviewer')) agents[agents.length - 1] = 'codex-reviewer'
  return { count: agents.length, agents }
}

/** Record the fulfilled external seat for a CLI review path without inflating the panel. */
interface ExternalReviewSidecarOptions {
  repoRoot: string
  taskId: string
  result: ReturnType<typeof invokeExternalReview>
  tier?: ShipTier
  collaborationMode?: 'trunk-solo' | 'peer-review' | 'gated-review'
  treatment?: Pick<ShipTreatment, 'finalReviewers' | 'reviewerVerticals' | 'signalsHash'>
  expectedSha?: string
}

function reviewSidecarHead(
  repoRoot: string,
  expectedSha?: string,
): { branch: string; sha: string } {
  const branch = currentBranch(repoRoot)
  const sha = headSha(repoRoot)
  if (branch === 'unknown' || sha === 'unknown') {
    throw new Error('cannot bind dispatch sidecar to Git HEAD')
  }
  if (expectedSha !== undefined && sha !== expectedSha) {
    throw new Error(`HEAD drifted from frozen review candidate ${expectedSha} (current ${sha})`)
  }
  return { branch, sha }
}

function writeExternalReviewSidecar({
  repoRoot,
  taskId,
  result,
  tier = 'Standard',
  collaborationMode = 'peer-review',
  treatment,
  expectedSha,
}: ExternalReviewSidecarOptions): void {
  if (result.status !== 'fulfilled' || !result.recorded || result.envelope === undefined) return
  assertSafeArbiterEvidenceRoot(repoRoot)
  const sidecarPath = join(repoRoot, '.arbiter', 'agents-dispatched.json')
  assertSafeSidecarFile(sidecarPath)
  const { branch, sha } = reviewSidecarHead(repoRoot, expectedSha)
  const existing = readSidecar(repoRoot)
  const panel = treatment
    ? treatmentSidecarAgents(existing, treatment.finalReviewers)
    : sidecarAgents(existing, branch, sha, taskId, { tier, collaborationMode })
  writeFileContained(
    repoRoot,
    join('.arbiter', 'agents-dispatched.json'),
    `${JSON.stringify(
      {
        ...panel,
        ...(treatment !== undefined
          ? { auditors: treatment.reviewerVerticals, treatmentHash: treatment.signalsHash }
          : {}),
        expectedProvenance: { 'codex-reviewer': CODEX_REVIEWER_PROVENANCE },
        taskId,
        branch,
        sha,
      },
      null,
      2,
    )}\n`,
  )
}

function treatmentSidecarAgents(
  existing: ReviewSidecar | null,
  panelSize: number,
): { count: number; agents: string[] } {
  const existingAgents = existing === null ? [] : (readSidecarAgents(existing) ?? [])
  const nonCodex = existingAgents.filter((agent) => agent !== 'codex-reviewer')
  const requiredAnthropic = Math.max(0, panelSize - 1)
  const agents = nonCodex.slice(0, requiredAnthropic)
  for (let index = agents.length; index < requiredAnthropic; index += 1) {
    agents.push(index === 0 ? 'anthropic-reviewer' : `anthropic-reviewer-${index + 1}`)
  }
  agents.push('codex-reviewer')
  return { count: panelSize, agents }
}

function assertReviewTreeClean(repoRoot: string): void {
  const status = runCli('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repoRoot,
    timeoutMs: 15_000,
  }).stdout
  const unreviewed = status
    .split(/\r?\n/)
    .filter((line) => line.length > 2)
    .map((line) => line.slice(3))
    .filter((path) => path.length > 0 && !path.startsWith('.arbiter/'))
  if (unreviewed.length > 0) {
    throw new Error(
      `working tree has uncommitted changes; commit before external review (${unreviewed.join(', ')})`,
    )
  }
}

type FrozenReviewBrief = {
  criteria: { id: string; text: string }[]
  nonGoals: string[]
  acHash: string
  planPath: string
  planBody: string
}

const FROZEN_REVIEW_BRIEF_SCRIPT = [
  "import { readFileSync } from 'node:fs'",
  "import { pathToFileURL } from 'node:url'",
  'const { computeAcHash, parsePlanAnchor, parsePlanPresentation } = await import(pathToFileURL(process.argv[1]).href)',
  "const body = readFileSync(0, 'utf8')",
  'const anchor = parsePlanAnchor(body)',
  'const presentation = parsePlanPresentation(body)',
  "if (anchor === null || anchor.criteria.length === 0) throw new Error('no acceptance criteria')",
  "if (presentation === null) throw new Error('malformed acceptance criteria presentation')",
  "if (anchor.criteria.some(({ explicit }) => !explicit) || new Set(anchor.criteria.map(({ id }) => id)).size !== anchor.criteria.length) throw new Error('malformed acceptance criteria')",
  'process.stdout.write(JSON.stringify({ criteria: presentation.criteria, nonGoals: presentation.nonGoals, acHash: computeAcHash(anchor.criteria) }))',
].join(';')

function frozenPlanPath(planRef: string): string {
  const plan = planRef.split('#')[0]?.trim() ?? ''
  if (
    plan.length === 0 ||
    plan.startsWith('/') ||
    plan.includes('\\') ||
    plan.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('frozen plan reference is missing or unsafe')
  }
  return plan
}

function isFrozenReviewBrief(value: unknown): value is FrozenReviewBrief {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const brief = value as Record<string, unknown>
  return (
    Array.isArray(brief.criteria) &&
    brief.criteria.length > 0 &&
    brief.criteria.every(
      (criterion) =>
        typeof criterion === 'object' &&
        criterion !== null &&
        typeof (criterion as { id?: unknown }).id === 'string' &&
        (criterion as { id: string }).id.length > 0 &&
        typeof (criterion as { text?: unknown }).text === 'string' &&
        (criterion as { text: string }).text.length > 0,
    ) &&
    Array.isArray(brief.nonGoals) &&
    brief.nonGoals.every((nonGoal) => typeof nonGoal === 'string') &&
    typeof brief.acHash === 'string' &&
    brief.acHash.length > 0
  )
}

function readFrozenReviewBrief(
  repoRoot: string,
  planRef: string,
  reviewHead: string,
): FrozenReviewBrief {
  const plan = frozenPlanPath(planRef)
  try {
    const body = runCli('git', ['show', `${reviewHead}:${plan}`], {
      cwd: repoRoot,
      timeoutMs: 5000,
    }).stdout
    const stdout = runCli(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        FROZEN_REVIEW_BRIEF_SCRIPT,
        join(repoRoot, 'scripts', 'lib', 'acceptance-criteria.mjs'),
      ],
      { cwd: repoRoot, input: body, timeoutMs: 5000 },
    ).stdout
    const brief: unknown = JSON.parse(stdout)
    if (!isFrozenReviewBrief(brief)) throw new Error('acceptance criteria are missing or malformed')
    return { ...brief, planPath: plan, planBody: body }
  } catch (error) {
    throw new Error(
      `cannot read frozen plan acceptance criteria at ${reviewHead}:${plan}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

function readFrozenTddEvidence(
  repoRoot: string,
  taskId: string,
  reviewHead: string,
): string | null {
  if (!/^#[1-9]\d*$/.test(taskId)) return null
  try {
    const receipt = runCli('git', ['show', `${reviewHead}:.arbiter/evidence/tdd/${taskId}.json`], {
      cwd: repoRoot,
      timeoutMs: 5000,
    }).stdout
    return Buffer.byteLength(receipt, 'utf8') <= 16 * 1024 ? receipt.trim() : null
  } catch {
    return null
  }
}

function resolveReviewBase(repoRoot: string, baseSha: string | null | undefined): string {
  const base =
    baseSha ??
    runCli('git', ['rev-parse', 'origin/main'], { cwd: repoRoot, timeoutMs: 5000 }).stdout.trim()
  if (base.length === 0) throw new Error('review base SHA is unavailable')
  return base
}

function assertFrozenReviewHead(repoRoot: string, reviewHead: string | null): string {
  if (reviewHead === null || reviewHead.length === 0)
    throw new Error('frozen review HEAD is missing')
  const liveHead = runCli('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    timeoutMs: 5000,
  }).stdout.trim()
  if (liveHead !== reviewHead) {
    throw new Error(`HEAD drifted from frozen review candidate ${reviewHead} (current ${liveHead})`)
  }
  return reviewHead
}

function frozenReviewPrompt(
  taskId: string,
  baseSha: string,
  headSha: string,
  brief: FrozenReviewBrief,
  tddEvidence: string | null,
): string {
  return [
    'Review this frozen candidate for bugs, type safety, security, data integrity, silent failures, and acceptance fit.',
    'Review scope is the frozen diff. Do not block on unavailable local command execution, pending CI, merge state, or other post-review delivery evidence; separate gates own those checks.',
    'Every blocking finding must cite a concrete candidate defect with a file and line. Do not turn inability to verify into a defect.',
    `Task: ${taskId}`,
    `Base SHA: ${baseSha}`,
    `Head SHA: ${headSha}`,
    `Diff: ${baseSha}..${headSha}`,
    `Acceptance criteria hash: ${brief.acHash}`,
    'Acceptance criteria (ordered, verbatim):',
    ...brief.criteria.map(({ id, text }, index) => `${index + 1}. ${id}: ${text}`),
    'Non-goals:',
    ...(brief.nonGoals.length > 0 ? brief.nonGoals.map((item) => `- ${item}`) : ['- (none)']),
    `Frozen plan (${brief.planPath} at ${headSha}; commands are requirements, not proof of execution):`,
    brief.planBody,
    'Recorded TDD RED evidence (proves the recorded failure only):',
    tddEvidence ?? '(none recorded)',
  ].join('\n')
}

interface ShipExternalReviewInvocation {
  options: ShipCrossModelReviewOptions
  repoRoot: string
  diff: string
  access: ExternalModelAccess | undefined
  preflightDegradation: 'invocation-failed' | undefined
  preflightError: unknown
  prompt: string
  expectedSha: string
}

function invokeShipExternalReview({
  options,
  repoRoot,
  diff,
  access,
  preflightDegradation,
  preflightError,
  prompt,
  expectedSha,
}: ShipExternalReviewInvocation): ReturnType<typeof invokeExternalReview> {
  return invokeExternalReview({
    repoRoot,
    taskId: options.taskId,
    prompt,
    diff,
    cfg: options.cfg,
    ...(access !== undefined ? { access } : {}),
    ...(preflightDegradation !== undefined ? { preflightDegradation, preflightError } : {}),
    tier: options.tier,
    phase: options.phase,
    vertical: options.vertical,
    expectedSha,
  })
}

function persistShipReviewSidecar(
  options: ShipCrossModelReviewOptions,
  repoRoot: string,
  result: ReturnType<typeof invokeExternalReview>,
): void {
  if (!existsSync(repoRoot)) return
  writeExternalReviewSidecar({
    repoRoot,
    taskId: options.taskId,
    result,
    tier: options.tier,
    collaborationMode: options.collaborationMode ?? 'peer-review',
    ...(options.headSha !== null ? { expectedSha: options.headSha } : {}),
    ...(options.treatment !== undefined ? { treatment: options.treatment } : {}),
  })
}

/** Run the automatic refactor-step bridge; consent-off runs only the local degradation recorder. */
function runShipCrossModelReview(
  options: ShipCrossModelReviewOptions,
): ReturnType<typeof invokeExternalReview> {
  const repoRoot = resolve(options.dir)
  const reviewHead = assertFrozenReviewHead(repoRoot, options.headSha)
  const reviewBase = resolveReviewBase(repoRoot, options.baseSha)
  const brief = readFrozenReviewBrief(repoRoot, options.planRef, reviewHead)
  const prompt = frozenReviewPrompt(
    options.taskId,
    reviewBase,
    reviewHead,
    brief,
    readFrozenTddEvidence(repoRoot, options.taskId, reviewHead),
  )
  let diff = ''
  let access = options.cfg.diffEgressConsent ? options.access : undefined
  let preflightError: unknown
  let preflightDegradation: 'invocation-failed' | undefined
  if (options.cfg.diffEgressConsent) {
    try {
      assertReviewTreeClean(repoRoot)
      if (options.cfg.enabled && hasCurrentFulfilledReview(repoRoot, options.taskId)) {
        assertFrozenReviewHead(repoRoot, reviewHead)
        return {
          provider: 'codex',
          status: 'fulfilled',
          diffBytes: 0,
          diffTruncated: false,
          degradationReasons: [],
          recorded: true,
        }
      }
      diff = runCli('git', ['diff', '--binary', `${reviewBase}..${reviewHead}`], {
        cwd: repoRoot,
        timeoutMs: 15_000,
      }).stdout
      // FAIL-OPEN-INTENT: a preflight failure is recorded as an explicit degradation; no diff is sent.
    } catch (error) {
      access = undefined
      preflightError = error
      preflightDegradation = 'invocation-failed'
    }
  }
  assertFrozenReviewHead(repoRoot, reviewHead)
  const result = invokeShipExternalReview({
    options,
    repoRoot,
    diff,
    access,
    preflightDegradation,
    preflightError,
    prompt,
    expectedSha: reviewHead,
  })
  persistShipReviewSidecar(options, repoRoot, result)
  return result
}

export { runCrossModelReview, runShipCrossModelReview, writeExternalReviewSidecar }

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch (error) {
    throw toFsError(error, 'stdin')
  }
}
