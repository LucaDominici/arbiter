// SPDX-License-Identifier: Apache-2.0
//
// `arbiter ship <id>` (#1206) — the orchestrator.
//
// Drives an issue toward a reviewed, merged PR by auto-sequencing arbiter's EXISTING engine
// (worktree → plan → TDD impl → one final review → verify → gate → merge → cleanup).
// This is the next-action COMPUTER + auto-advance-on-gate-green: it cannot itself write code or
// dispatch review subagents (those need the agent), so `arbiter ship` computes the next concrete
// step and advances the phase when its gate is green; the `/ship` slash command is the loop that
// executes the model-requiring steps between calls. Reuses runTaskAdvance + the existing gates.
import { ensureDir, writeFileTranslated } from '../utils/fs.js'
import { FatalError, UserFacingError } from '../utils/errors.js'
import { t } from '../i18n/index.js'
import { join } from 'node:path'
import { z } from 'zod'
import {
  type TaskPhase,
  PHASE_ORDER,
  readUnifiedState,
  writeUnifiedState,
  appendLog,
  normalizeChainId,
  type TaskStatePatch,
  type UnifiedTaskState,
  reviewStateOf,
} from './task-state.js'
import { assertShipHostBinding, runTaskAdvance, runTaskResume, runTaskReviewRound } from './task.js'
import { sanitizeTaskId } from '../worktree/paths.js'
import {
  autonomyAllows,
  type ShipProfile,
  CONSUMER_DEFAULT_PROFILE,
  SELF_ONLY_GATES,
  resolveShipProfile,
} from './ship-profile.js'
import { companionGreenInstruction, companionStatusLine } from '../integrations/companions.js'
import { CliError, runCli } from '../utils/run-cli.js'
import type { ExternalModelAccess } from '../detectors/external-model.js'
import { planCrossModelSlots } from '../integrations/external-review.js'
import { runShipCrossModelReview } from './cross-model-review.js'
import { runTaskNote, type TaskNoteOptions } from './task-note.js'
import {
  gatherTierSignals,
  normTier,
  resolveShipTreatment,
  evaluatePremortem,
  readPlanManifest,
  type ShipTreatment,
  type ShipExecutionOutcome,
  type ShipTier,
  type TierSignals,
  type PremortemDecision,
} from './ship-tier.js'

import {
  appendChainIds,
  disjointFilesFor,
  evaluateAffinity,
  evaluateSeal,
  evaluateSeedSize,
  hasShipTaskId,
  isLegacyAffinity,
  resolveTrainLimits,
  shipTaskChanged,
  type TrainLimits,
  type AffinityVerdict,
  type TrainAffinitySignals,
  type TrainSignals,
} from './ship-train.js'
import { reviewScopeLine, type PlannedReviewRound } from './ship-review.js'
import { shipConfigFor } from './ship-config.js'
import type { PrSnapshot } from './pr-merged.js'
import type { ShipConfig } from '../config/schema.js'

/**
 * #1280 — normalize the positional ship id to the canonical `#NNN` form ONCE at parse.
 * The TDD-evidence schema requires `^#\d+$` and the gate's identity check compares
 * against the taskId persisted here, so a bare id (`ship 1280 ...`) written verbatim
 * makes the gate unsatisfiable. Non-numeric ids fail loud rather than being coerced
 * into an id no gate can ever match. (NB: `worktree/paths.js::sanitizeTaskId` is the
 * `#NNN` normalizer; the same-named `utils/task-id.js` helper is a filesystem-segment
 * sanitizer that strips `#` — the wrong tool here.)
 */
function normalizeShipTaskId(raw: string): string {
  const id = sanitizeTaskId(raw)
  if (!/^#\d+$/.test(id)) {
    throw new Error(
      `Invalid ship task id "${raw}" — expected a GitHub issue number like "1280" or "#1280".`,
    )
  }
  return id
}

type CompanionDiffStats = { files: number; insertions: number; deletions: number }

const CompanionEvidenceV1 = z.object({
  $schemaVersion: z.literal(1),
  companions: z
    .array(
      z.object({
        id: z.string().min(1),
        mode: z.enum(['lite', 'full']),
      }),
    )
    .min(1),
  diffStats: z.object({
    files: z.number().int().nonnegative(),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }),
  recordedAt: z.iso.datetime(),
})

type CompanionEvidenceV1 = z.infer<typeof CompanionEvidenceV1>

/** Backward-compatible projection; the treatment resolver remains the only policy owner. */
export function verticalsForTier(tier: ShipTier): string[] {
  return resolveShipTreatment(tier, {
    blastRadius: 0,
    callerCount: 0,
    changedFiles: ['src/domain.ts'],
    complete: true,
    labels: [],
    milestoneBundled: false,
  }).reviewerVerticals
}

interface ShipStep {
  phase: TaskPhase
  /** What the agent must do while in this phase. */
  action: string
  /** Arbiter command that completes / gates this phase, if any. */
  command?: string
  /** Number of review subagents the agent must dispatch in this phase (0 = none). */
  reviewAgents: number
  /** #2357 — optional external seat; reviewAgents remains the total panel size. */
  externalReviewers?: number
  /**
   * #1260 — the orthogonal VERTICAL floor for this ship's size (tier), as real
   * auditor-routing.json names. Larger size widens this breadth. The review phases
   * dispatch across these verticals; #1267's dispatch matrix consumes the same set
   * (it equals `sizeVerticals(tier)`). Present on every step so it travels end-to-end.
   */
  verticals: string[]
  /**
   * #1288 — arbiter authoring-side gates that run in this phase and are self-only-forever
   * (ADR-093 §5: template-authoring / selfOnly invariants / matrix-fixtures). Populated ONLY
   * for the arbiter repo itself; OMITTED (empty) for a consumer repo, where those concerns do
   * not exist — skipped, not faked (INV-115). Only the `verification` phase carries any.
   */
  selfOnlyChecks?: string[]
  /**
   * #2400 — for a re-review (round ≥ 2), the diff range this round covers and the severity rule
   * that ends it. Absent on round 1 (which reads the whole change) and on every invocation that
   * did not dispatch a round.
   */
  reviewScope?: string
}

interface ShipStepContext {
  taskId?: string
  chainIds?: readonly string[]
  verticals: readonly string[]
  externalModelAccess?: ExternalModelAccess
  /** #2400 — the review round this invocation opened, when it opened one. */
  review?: PlannedReviewRound
  /** #2850 — the anchored plan, so the plan step names it instead of a guessed default. */
  plan?: string
  treatment: ShipTreatment
}

type ShipStepTail = readonly string[] | Omit<ShipStepContext, 'verticals' | 'treatment'>

function normalizeShipStepTail(
  tail: ShipStepTail,
): Omit<ShipStepContext, 'verticals' | 'treatment'> {
  if (Array.isArray(tail)) return { chainIds: tail as readonly string[] }
  return tail as Omit<ShipStepContext, 'verticals'>
}

/**
 * The concrete step for a given phase + tier + ship profile. Size (tier) drives BOTH
 * `reviewAgents` and `verticals`; the #1288 profile drives the config-aware `complete` merge
 * action and the self-only authoring gates on `verification`. The profile defaults to the
 * consumer-safe profile so a profile-blind caller never leaks a self-only gate (RT-07).
 */
export function shipStepFor(
  phase: TaskPhase,
  tierOrTreatment: string | ShipTreatment | undefined,
  profile: ShipProfile = CONSUMER_DEFAULT_PROFILE,
  /** #2102 — the primary task id, named alongside `chainIds` in the close-step text. */
  taskId?: string,
  /** #2102/#2357 — legacy chain array or the optional injected review context. */
  tail: ShipStepTail = [],
): ShipStep {
  const normalizedTail = normalizeShipStepTail(tail)
  const treatment =
    typeof tierOrTreatment === 'object'
      ? tierOrTreatment
      : resolveShipTreatment(tierOrTreatment, {
          blastRadius: 0,
          callerCount: 0,
          changedFiles: ['src/domain.ts'],
          complete: true,
          labels: [],
          milestoneBundled: false,
        })
  const t = treatment.tier
  const verticals = treatment.reviewerVerticals
  const withVerticals = (step: Omit<ShipStep, 'verticals'>): ShipStep => ({ ...step, verticals })
  return withVerticals(
    shipStepBody(phase, t, profile, {
      ...normalizedTail,
      verticals,
      treatment,
      ...(taskId !== undefined ? { taskId } : {}),
    }),
  )
}

/**
 * The (collaborationMode × mergeMode) merge next-action (#1288 RT-02). A review mode
 * (peer-review / gated-review) ALWAYS requires a PR + human review — even if the user
 * persisted `solo.mergeMode:'direct'`, which would otherwise silently bypass the very review
 * the mode mandates. Only trunk-solo keys on mergeMode. Strings are strictly advisory and route
 * through the project gate — the engine never performs the merge itself.
 */
/**
 * #1730 — the green (implementation) action, optionally composed with active companion plugins.
 * When a companion (ponytail) is active on the resolved profile, its YAGNI drafting instruction is
 * appended; absent ⇒ the base string, byte-identical to a companion-free ship. The self-guard lives
 * at resolution (profile.companions is empty on arbiter-self), so no leak path exists here.
 */
// #2875 AC-2: a base merge integrates as a merge commit, never a rebase — TDD evidence pins
// commit SHAs, and a rebase rewrites the very SHAs the evidence and review rounds are bound to.
const MERGE_NOT_REBASE =
  'integrate main with a merge commit, never rebase (TDD evidence pins commit SHAs)'

function greenAction(profile: ShipProfile): string {
  const base = 'Implement the minimum to make the tests pass.'
  const companion = companionGreenInstruction(profile.companions)
  return companion ? `${base} ${companion}` : base
}

/**
 * #A11 — CLOSER mode action for the `close` phase (last mile: merge, red gate, conflict).
 * Entry into this phase activates the closer-mode guard hook:
 * single named target (no switching), no new issues/refactor beyond the diff (findings → PARKING,
 * one line, no action), same error twice → 5-line root-cause or declare BLOCKED, foreground waits
 * only (no background "monitor" for gate/PR checks), never end on a promise.
 */
function closeAction(profile: ShipProfile): string {
  const doneEvidence = profile.evidenceHarness
    ? ' The exact-head required-check CI receipt is completion evidence; use `node scripts/done-evidence.mjs` only when the repository has no required CI checks.'
    : ''
  const exactLanding =
    profile.collaborationMode === 'trunk-solo' && profile.mergeMode === 'pr-ff'
      ? ' Mark the draft ready with `gh pr ready <pr>`, then land only with `node scripts/pr-merge-watch.mjs <owner/repo> <pr>`; it refuses drafts and refuses before GitHub unless lifecycle, review, applicable acceptance, receipt, and local HEAD agree.'
      : ''
  return (
    'CLOSER mode: single named target, no new issues or refactor beyond the diff ' +
    '(findings → PARKING list, one line, no action). Same error twice → 5-line root-cause, ' +
    'else declare BLOCKED. Reuse the recorded CI verdict for the unchanged pushed SHA; do not run another local full gate.' +
    doneEvidence +
    exactLanding +
    ' Push, then foreground-wait on the PR/gate checks; never end the turn on a promise.'
  )
}

/**
 * #2102 — the close-issues fragment of the complete-action text. Names every id in
 * `[taskId, ...chainIds]` when a chain is declared; unchanged single-issue text otherwise
 * (byte-identical to pre-#2102 for the no-chain case). Ids display with a leading `#`
 * regardless of how they were persisted (`task init --id` stores the raw form; `ship`'s
 * own seeding normalizes to `#NNN` — display normalizes both so the chain reads uniformly).
 */
function closeIssuesPhrase(taskId: string | undefined, chainIds: readonly string[]): string {
  if (chainIds.length === 0) return 'Close the issue, clean up the worktree.'
  const display = (id: string): string => (id.startsWith('#') ? id : `#${id}`)
  const ids = [taskId, ...chainIds].filter((v): v is string => Boolean(v)).map(display)
  return `Close issues ${ids.join(', ')}, clean up the worktree.`
}

function completeAction(
  profile: ShipProfile,
  taskId?: string,
  chainIds: readonly string[] = [],
): string {
  const closePhrase = closeIssuesPhrase(taskId, chainIds)
  if (profile.collaborationMode !== 'trunk-solo') {
    return `Commit, push, open a PR; await required review + checks, then merge. ${closePhrase}`
  }
  if (profile.mergeMode === 'direct') {
    return `Commit and push to the project's default branch through its gate (no PR). ${closePhrase}`
  }
  return `Commit, push, open a PR, fast-forward merge once checks pass. ${closePhrase}`
}

/**
 * The self-only authoring gates that run in the `verification` phase — the 3 ADR-093 §5 gates
 * for arbiter-self, empty for a consumer repo (skipped, not faked). Extracted so the decision
 * stays out of `shipStepBody`'s switch (keeps it under the complexity ceiling).
 */
function verificationSelfOnlyChecks(profile: ShipProfile): string[] {
  return profile.isArbiterSelf ? [...SELF_ONLY_GATES] : []
}

type ReviewPhase = 'refactor'
function isReviewPhase(phase: TaskPhase): phase is ReviewPhase {
  return phase === 'refactor'
}

/**
 * #2400 — the delta-scope annotation for a re-review, or undefined when there is nothing to
 * narrow: round 1 reads the whole change, and a round whose base sha is unknown has no range.
 */
function reviewScopeFor(plan: PlannedReviewRound | undefined): string | undefined {
  if (plan === undefined || plan.rounds < 2 || plan.base === null) return undefined
  return reviewScopeLine(plan.base, plan.rounds, plan.maxRounds)
}

function reviewPhaseStepBody(
  phase: ReviewPhase,
  t: ShipTier,
  profile: ShipProfile,
  context: Pick<
    ShipStepContext,
    'taskId' | 'verticals' | 'externalModelAccess' | 'review' | 'treatment'
  >,
): Omit<ShipStep, 'verticals'> {
  const { taskId, verticals, externalModelAccess, review: reviewPlan, treatment } = context
  const reviewAgents = treatment.finalReviewers
  const plan = planCrossModelSlots({
    tier: t,
    phase,
    totalSlots: reviewAgents,
    verticals,
    ...(profile.crossModelReview !== undefined ? { cfg: profile.crossModelReview } : {}),
    ...(externalModelAccess !== undefined ? { access: externalModelAccess } : {}),
  })
  const externalCount = plan.external.length
  const scope = reviewScopeFor(reviewPlan)
  const cli = profile.isArbiterSelf ? 'node dist/cli.js' : 'arbiter'
  const prepare = `Run touched tests, formatter/linter on changed files, and \`git diff --check\`; if main advanced, ${MERGE_NOT_REBASE}; commit the frozen candidate, push it and open its draft PR once so CI starts with \`git push -u origin HEAD && gh pr create --draft --fill\` (reuse the PR when \`gh pr view\` finds one), then`
  // #2862: the draft creation stays a plain command of its own — inside this chain the
  // command substitutions make it unverifiable, so the PR guard refused it.
  const reviewCommand = [
    'candidate="$(git rev-parse HEAD)"',
    'branch="$(git branch --show-current)"',
    'test -n "$branch"',
    'git push -u origin "$branch"',
    'test "$(git rev-parse HEAD)" = "$candidate"',
    `${cli} ship '${taskId ?? '#NNN'}' --review-round`,
  ].join(' && ')
  const step: Omit<ShipStep, 'verticals'> = {
    phase,
    action:
      externalCount > 0
        ? `${prepare} dispatch ${reviewAgents - externalCount} Anthropic code-review agent(s) + ${externalCount} Codex reviewer(s); panel total: ${reviewAgents}.`
        : `${prepare} dispatch ${reviewAgents} independent final reviewer(s) covering code, tests, and acceptance.`,
    command: reviewCommand,
    reviewAgents,
    ...(scope !== undefined ? { reviewScope: scope } : {}),
  }
  return externalCount > 0 ? { ...step, externalReviewers: externalCount } : step
}

/**
 * #2875 AC-4 — the task-scoped default (`.claude/plans/task-<N>.md`) that both the plan step and
 * the preflight step name, unless an already-anchored plan (e.g. a root `PLAN.md`) overrides it.
 */
function resolvePlanPath(issue: string, plan: string | undefined): string {
  const anchored = plan === 'unknown' ? undefined : plan?.split('#')[0]?.trim()
  return anchored || `.claude/plans/task-${issue}.md`
}

/**
 * #2329 — batching guidance is model-side prose (the wave-drain skill), not a config knob.
 * #2724 — plan admission is mechanical; review is reserved for the frozen candidate.
 * #2850 — the step names the ANCHORED plan (D2) and the admission the red transition will run
 * (D1), so the issue-AC obligation is known before the writer starts rather than found by failing.
 */
function planStepBody(
  cli: string,
  t: ShipTier,
  context: Pick<ShipStepContext, 'taskId' | 'plan'>,
): Omit<ShipStep, 'verticals'> {
  const issue = context.taskId?.replace(/^#/, '') ?? 'NNN'
  const plan = resolvePlanPath(issue, context.plan)
  return {
    phase: 'plan',
    action:
      'Write the plan with scope and acceptance criteria; the issue body must carry every criterion as `AC-N:` and the plan must freeze them verbatim. ' +
      `Prove admission before TDD: \`node scripts/check-acceptance.mjs --plan ${plan} --admit-issue ${issue}\`.`,
    command: `${cli} lifecycle start --id '${context.taskId ?? '#NNN'}' --tier ${t} --plan ${plan}`,
    reviewAgents: 0,
  }
}

/** The phase body (count + action), before the size-derived vertical floor is attached. */
function shipStepBody(
  phase: TaskPhase,
  t: ShipTier,
  profile: ShipProfile,
  context: ShipStepContext,
): Omit<ShipStep, 'verticals'> {
  if (isReviewPhase(phase)) {
    return reviewPhaseStepBody(phase, t, profile, context)
  }

  const cli = profile.isArbiterSelf ? 'node dist/cli.js' : 'arbiter'

  switch (phase) {
    case 'preflight': {
      const issue = context.taskId?.replace(/^#/, '') ?? 'NNN'
      const plan = resolvePlanPath(issue, context.plan)
      return {
        phase,
        action: 'Open the worktree, read the issue, write task state.',
        command: `${cli} lifecycle start --id '${context.taskId ?? '#NNN'}' --tier ${t} --plan ${plan}`,
        reviewAgents: 0,
      }
    }
    case 'plan':
      return planStepBody(cli, t, context)
    case 'red':
      return {
        phase,
        action: 'Write failing tests first (TDD red); record evidence.',
        command: `${cli} lifecycle record-red --task '${context.taskId ?? '#NNN'}' --test-path <test-path>`,
        reviewAgents: 0,
      }
    case 'green':
      return {
        phase,
        action: greenAction(profile),
        reviewAgents: 0,
      }
    case 'verification': {
      return {
        phase,
        action: `The pre-push hook already ran one local preflight plus touched tests before the draft PR; CI runs the full gate on that SHA and is the verification authority. If main advanced, ${MERGE_NOT_REBASE}. Record its verdict with \`node scripts/ci-receipt.mjs\` before \`advance --to close\`.`,
        command: 'node scripts/ci-receipt.mjs',
        reviewAgents: 0,
        // Self-only authoring gates run here for arbiter-self only; a consumer repo has no
        // such concern, so the list is empty (skipped, not faked — ADR-093 §5 / INV-115).
        selfOnlyChecks: verificationSelfOnlyChecks(profile),
      }
    }
    case 'close':
      return {
        phase,
        action: closeAction(profile),
        reviewAgents: 0,
      }
    case 'complete':
      return {
        phase,
        action: completeAction(profile, context.taskId, context.chainIds),
        reviewAgents: 0,
      }
  }
}

/** The forward (non-lateral) phase after `current`, or null at the end. */
export function nextPhase(current: TaskPhase): TaskPhase | null {
  const idx = PHASE_ORDER.indexOf(current)
  if (idx === -1 || idx >= PHASE_ORDER.length - 1) return null
  return PHASE_ORDER[idx + 1] ?? null
}

export interface TaskShipOptions {
  dir?: string
  taskId?: string
  tier?: string
  /**
   * #2102 — `--chain <id>` (repeatable): other issue ids batched into this same ship run's
   * worktree/gate/PR. Only written when provided (`undefined` leaves any previously-declared
   * chain untouched — a bare `arbiter ship --advance` must never silently clear it).
   */
  chainIds?: string[]
  /**
   * #2331 — `--chain-add <id>` (repeatable): APPEND to the declared chain instead of replacing
   * it, so a train can accumulate as issues are understood. Refused with a SEALED error when a
   * stop condition holds — the caller lands the train instead of growing it.
   */
  chainAddIds?: string[]
  /** Complete, explicit affinity inputs for a dynamic train append. */
  trainAffinity?: TrainAffinitySignals
  /** #2331 — `--seal`: close the train now, whatever the other signals say. */
  seal?: boolean
  /**
   * Test seam AND per-run override: deterministic train bounds without touching config or wall
   * time. Beats `ship.train` in `arbiter.json` (#2401), which beats {@link DEFAULT_TRAIN_LIMITS}.
   */
  trainLimits?: TrainLimits
  /** Test seam for a deterministic train clock. */
  now?: Date
  /**
   * #2400 — `--review-round`: record another review round on a task already in `refactor`.
   * Entering `refactor` records round 1 on its own; every re-dispatch after that says so here,
   * because no git heuristic can tell a commit made FOR a review from one made in RESPONSE to it.
   */
  reviewRound?: boolean
  /** #2400 — `--force-review`: take a round past the cap, and record that it was forced. */
  forceReview?: boolean
  /** Test seam: the review-round cap, bypassing `ship.review.maxRounds`. */
  reviewMaxRounds?: number
  /** Test seam: HEAD for the review pin. `null` means "unreadable"; absent means "ask git". */
  headSha?: string | null
  /** Result of the last attempt; drives bounded escalation without conflating infrastructure. */
  executionOutcome?: ShipExecutionOutcome
  /** #1291 — per-run --autonomy override (flag > arbiter.json automation.autonomy > L0). */
  autonomy?: string
  /**
   * #1305 (ADR-094 §Decision.2) — generic per-run `--set <path>=<value>` overrides for this ship
   * invocation, gated by OVERRIDABLE_PATHS at the CLI boundary. Forwarded to resolveShipProfile.
   */
  overrides?: Record<string, string>
  /** Advance to the next phase first (runs that phase's gate; throws if the gate is red). */
  advance?: boolean
  /** Test seam for identifying a native linked checkout without shelling out to Git. */
  isLinkedCheckout?: (root: string) => boolean
  /** Bubble handoff control-flow to the caller instead of being swallowed. */
  advanceOpts?: {
    /** #2402 — forwarded to the `complete` landing gate; without these `ship --advance` into
     *  `complete` would have no escape hatch at all. */
    noPr?: boolean
    pr?: number
    readPrs?: (branch: string, dir: string) => PrSnapshot[]
  }
  /** Test seam for evidence emission without depending on local HOME/plugin state. */
  profileOverride?: ShipProfile
  /** Test seam for deterministic companion evidence diff stats. */
  gatherCompanionDiffStats?: (repoDir: string) => CompanionDiffStats
  /** Test seam for deterministic tier-routing signals without graphify or GitHub CLI state. */
  gatherTierSignals?: (root: string, taskId: string | undefined, planPath?: string) => TierSignals
  /** Test seam for deterministic companion evidence timestamps. */
  recordedAt?: string
  /** #2357 — external-model detection is performed at the CLI edge and injected here. */
  externalModelAccess?: ExternalModelAccess
  /** #2890 — `--premortem`: force the plan-step decision to `required`. */
  premortem?: true
}

export interface ShipResult {
  phase: TaskPhase
  step: ShipStep
  advanced: boolean
  done: boolean
  /** The effective tier after deterministic widening. Present on all real ship invocations. */
  tier?: ShipTier
  treatment?: ShipTreatment
  trainDecision?: AffinityVerdict
  /** True only when this invocation actually opens a reviewer dispatch. */
  reviewDispatched?: boolean
  /** Summary emitted after a runtime-owned external seat completes. */
  reviewSummary?: string
  /** #2910 — printed first when the round opened with no reviewer seat (nothing dispatched). */
  reviewNote?: string
  /** Frozen reviewer-panel identity printed only for the round this invocation opened. */
  reviewSubject?: {
    taskId: string
    branch: string
    sha: string
    criteriaIds: string[]
    criteriaCommand: string
  }
  checkpoint?: Pick<UnifiedTaskState, 'cursor' | 'review'>
  /** #1288 — the ship profile resolved from the target repo's arbiter.json. */
  profile: ShipProfile
  /** Plan-time verification contract persisted in the active task state (#2773). */
  derivedGates?: unknown[]
  /** Debt metrics measured read-only at a Standard plan step (#2863). */
  debtCurrent?: Record<string, number>
  /** #2890 AC-1 — deterministic premortem decision, computed and persisted at the plan step. */
  premortem?: PremortemDecision
}

/**
 * Build the human-readable step-output lines for a ship invocation, including the
 * #1260 tier + vertical-breadth summary. Kept here (not inline in the CLI action) so the
 * action stays simple and the formatting is unit-testable.
 */
function checkpointShipStepLines(checkpoint: ShipResult['checkpoint']): string[] {
  const lines: string[] = []
  if (!checkpoint) return lines
  const { cursor, review } = checkpoint
  if (review)
    lines.push(`Candidate: ${review.lastReviewedSha ?? 'NO DATA'} · review round: ${review.rounds}`)
  if (cursor.lastAction) lines.push(`Observed: ${cursor.lastAction}`)
  if (cursor.nextAction) lines.push(`Next: ${cursor.nextAction}`)
  return lines
}

function reviewerEnvelope(
  subject: NonNullable<ShipResult['reviewSubject']>,
  vertical: string,
  includesAcceptanceFit: boolean,
): Record<string, unknown> {
  return {
    schema: 'arbiter-agent-return-v1',
    agent: vertical,
    role: 'reviewer',
    taskId: subject.taskId,
    branch: subject.branch,
    sha: subject.sha,
    ts: '<ISO-8601 timestamp>',
    verdict: '<PASS|WARN|FAIL>',
    confidence: 0,
    findings: [],
    ...(includesAcceptanceFit
      ? {
          acceptanceFit: {
            schema: 'arbiter-ac-fit-v1',
            taskId: subject.taskId,
            criteria: subject.criteriaIds.map((id) => ({
              id,
              verdict: '<PASS|FAIL|NOT-TESTED>',
              evidence: [{ file: '<repo-relative-path>', line: 1 }],
            })),
          },
        }
      : {}),
  }
}

function reviewPanelLines(result: ShipResult): string[] {
  const subject = result.reviewSubject
  if (subject === undefined) return []
  if (subject.criteriaIds.length === 0) {
    return [
      'Acceptance criteria unavailable from the frozen plan; no reviewer panel template was printed.',
      `List acceptance criteria: ${subject.criteriaCommand}`,
    ]
  }
  const panel = {
    envelopes: result.step.verticals.map((vertical, index) =>
      reviewerEnvelope(subject, vertical, index === 0),
    ),
  }
  return [
    'Reviewer panel template: replace <ISO-8601 timestamp>, <PASS|WARN|FAIL>, <PASS|FAIL|NOT-TESTED>, and <repo-relative-path>; set numeric confidence and evidence line values.',
    `node scripts/record-agent-return.mjs --mode reviewer-panel --task '${subject.taskId}' <<'JSON'`,
    ...JSON.stringify(panel, null, 2).split('\n'),
    'JSON',
    `node scripts/check-review-completion.mjs --task '${subject.taskId}'`,
  ]
}

function optionalShipStepLines(result: ShipResult, tier: ShipTier): string[] {
  const lines = checkpointShipStepLines(result.checkpoint)
  if (result.step.command) lines.push(`Command: ${result.step.command}`)
  if (result.step.reviewAgents > 0) lines.push(`Review agents: ${result.step.reviewAgents}`)
  if (result.step.externalReviewers !== undefined) {
    lines.push(`External reviewers: ${result.step.externalReviewers}`)
  }
  // #2400 — a re-review reads the delta, not the whole change. Printed only for the round it
  // describes, so it can never be mistaken for a standing property of the phase.
  if (result.step.reviewScope !== undefined) {
    lines.push(`Review scope: ${result.step.reviewScope}`)
  }
  lines.push(`Tier: ${tier} · verticals: ${result.step.verticals.join(', ')}`)
  if (result.treatment !== undefined) {
    lines.push(
      `Treatment: ${result.treatment.sensitive ? 'Sensitive' : result.treatment.tier} · model: ${result.treatment.modelCapability} · plan: ${result.treatment.planDepth}`,
    )
    lines.push(`Treatment reason: ${result.treatment.reasons.join('; ')}`)
  }
  if (result.trainDecision !== undefined) {
    lines.push(
      `Train: ${result.trainDecision.decision} · ${result.trainDecision.reason} · components=${JSON.stringify(result.trainDecision.components)}`,
    )
  }
  return lines
}

function displayGateValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return fallback
}

function roundLimit(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function formatDebtRatchet(
  name: string,
  value: number,
  tolerance: number,
  lowerIsBetter: boolean,
  current: number | undefined,
): string {
  const limit = lowerIsBetter
    ? `ceiling ${roundLimit(value + tolerance)}`
    : `floor ${roundLimit(value - tolerance)}`
  return `${name}: baseline ${value}, tolerance ${tolerance}, ${limit}, current: ${current ?? 'not measured at plan'}`
}

function formatGateThreshold(raw: unknown, debtCurrent: Record<string, number> = {}): string {
  const threshold = raw as {
    name?: unknown
    value?: unknown
    source?: unknown
    measurement?: unknown
    direction?: unknown
    tolerance?: unknown
  }
  if (
    typeof threshold.name === 'string' &&
    typeof threshold.value === 'number' &&
    typeof threshold.tolerance === 'number'
  ) {
    return formatDebtRatchet(
      threshold.name,
      threshold.value,
      threshold.tolerance,
      threshold.direction === 'lower-is-better',
      debtCurrent[threshold.name],
    )
  }
  const measurement =
    typeof threshold.measurement === 'string' ? ` via ${threshold.measurement}` : ''
  return `${displayGateValue(threshold.name, 'unnamed')}=${displayGateValue(threshold.value, 'unknown')} (${displayGateValue(threshold.source, 'unknown source')})${measurement}`
}

function derivedGateLines(
  derivedGates: unknown[] | undefined,
  debtCurrent: Record<string, number> | undefined,
): string[] {
  if (!derivedGates || derivedGates.length === 0) return []
  return [
    'Gates awaiting this change:',
    ...derivedGates.map((raw) => {
      const gate = raw as {
        name?: unknown
        command?: unknown
        verificationCommand?: unknown
        condition?: unknown
        thresholds?: unknown
        status?: unknown
        reason?: unknown
      }
      const details = [
        typeof gate.command === 'string' ? `command: ${gate.command}` : undefined,
        typeof gate.verificationCommand === 'string'
          ? `verification: ${gate.verificationCommand}`
          : undefined,
        typeof gate.condition === 'string' ? `when: ${gate.condition}` : undefined,
        Array.isArray(gate.thresholds)
          ? `thresholds: ${gate.thresholds.map((item) => formatGateThreshold(item, debtCurrent)).join(', ')}`
          : undefined,
        gate.status === 'unresolved'
          ? `UNRESOLVED: ${displayGateValue(gate.reason, 'reason unavailable')}`
          : undefined,
      ].filter(Boolean)
      const suffix = details.length > 0 ? ` — ${details.join('; ')}` : ''
      return `- ${displayGateValue(gate.name, 'unnamed gate')}${suffix}`
    }),
  ]
}

/** #2890 AC-1 — the plan-step premortem line, printed iff a decision was computed this run. */
function premortemStepLines(result: ShipResult): string[] {
  if (!result.premortem) return []
  const { decision, reason, areas, hooks, templates, workflows, sensitive, tier } = result.premortem
  return [
    `premortem: ${decision} reason=${reason} areas=${areas} hooks=${hooks} templates=${templates} workflows=${workflows} sensitive=${sensitive} tier=${tier}`,
  ]
}

function gateContractLines(result: ShipResult): string[] {
  if (result.phase === 'plan') return derivedGateLines(result.derivedGates, result.debtCurrent)
  if (result.phase === 'complete' || !result.derivedGates?.length) return []
  const count = result.derivedGates.length
  return [
    `Gate contract: ${count} obligation${count === 1 ? '' : 's'} frozen at plan; full details in .claude/.task/status.json.`,
  ]
}

function phaseActionLines(result: ShipResult): string[] {
  return [
    // #2910 AC-4 — a no-seat round says nobody was dispatched before anything else.
    ...(result.reviewNote !== undefined ? [result.reviewNote] : []),
    `Phase: ${result.phase}${result.done ? ' (done)' : ''}`,
    `Action: ${result.done ? 'Delivery complete. Clean up the worktree.' : result.step.action}`,
  ]
}

export function buildShipStepLines(result: ShipResult, legacyTier?: string): string[] {
  const tier = result.tier ?? normTier(legacyTier)
  const lines = phaseActionLines(result)
  lines.push(...optionalShipStepLines(result, tier))
  if (result.reviewSummary === undefined) lines.push(...reviewPanelLines(result))
  if (result.reviewSummary !== undefined) lines.push(result.reviewSummary)
  // #1288 — the governance level the profile resolved from the target repo (RT-08: a real
  // consumer of the field, so the read is honest and not dead config).
  lines.push(`Governance: ${result.profile.governanceLevel}`)
  // #1291 — the resolved autonomy level travels with every step so the driver
  // (and a human reading the banner) sees which behaviors are authorized.
  lines.push(`Autonomy: ${result.profile.autonomy}`)
  lines.push(...premortemStepLines(result))
  lines.push(...gateContractLines(result))
  if (
    result.phase === 'complete' &&
    !result.done &&
    !autonomyAllows(result.profile.autonomy, 'auto-merge')
  ) {
    lines.push(
      'Autonomy gate: STOP — merging requires a human at L0 (set automation.autonomy or pass --autonomy).',
    )
  }
  // Self-only authoring gates only — printed iff non-empty so a consumer repo NEVER shows a
  // header for gates it does not run (RT-06: skipped, not faked).
  const selfOnly = result.step.selfOnlyChecks ?? []
  if (selfOnly.length > 0) lines.push(`Self-only checks: ${selfOnly.join(', ')}`)
  // #1730 — announce active companion plugins on every step (transparency), read from the
  // resolved profile. Printed iff non-empty, mirroring self-only checks: a companion-free ship
  // shows no line at all. arbiter's gates remain the safety net for whatever the companion drafts.
  const companions = result.profile.companions
  if (companions.length > 0) {
    lines.push(
      `Companion: ${companionStatusLine(companions)} · arbiter gates remain the safety net`,
    )
  }
  return lines
}

/**
 * Seed state on first invocation so the orchestrator has an id/tier to work from.
 * #1280 — the positional id is normalized to canonical `#NNN` BEFORE the very first
 * write; everything downstream (evidence path lookup, task_id identity check) relies
 * on this form.
 */
/** #2402 — the seed bound now lives in `ship-train.ts`; both writers throw the same seal. */
function assertSeedWithinLimit(
  existing: UnifiedTaskState | null,
  taskId: string | undefined,
  chainIds: readonly string[] | undefined,
  limits: TrainLimits,
): void {
  const verdict = evaluateSeedSize(existing, taskId, chainIds, limits)
  if (verdict.ok) return
  const seal = { reason: 'max-chain' as const, detail: verdict.detail }
  throw new UserFacingError(t('errors.E_TRAIN_SEALED', seal))
}

/**
 * #2401 — the bounds this run enforces: `--trainLimits` > `ship.train` > the built-in default.
 * Threaded from one resolve so the seed check and the append check can never disagree about the
 * limit mid-run.
 */
function trainLimitsFor(
  ship: ShipConfig | undefined,
  opts: TaskShipOptions,
  tier?: ShipTier,
): TrainLimits {
  return opts.trainLimits ?? resolveTrainLimits(ship, tier)
}

/**
 * #2891 AC-2 — the cap-3 XS/S profile applies to BOTH the `--chain` seed path and the
 * `--chain-add` path, so the effective limit must be known before either check runs. Reuses
 * `chainAddContext`'s additions (the full declared membership on a seed, or the appended ids on
 * a chain-add) so a seed of 4 XS ids is refused exactly like a 4th `--chain-add` would be.
 */
function widestTrainTier(
  root: string,
  opts: TaskShipOptions,
  state: UnifiedTaskState | null,
  now: Date,
): ShipTier {
  const ctx = chainAddContext(opts, state)
  return trainSignalsFor(root, opts, {
    state: ctx.signalState,
    now,
    additions: ctx.additions,
    chainSize: ctx.currentSize,
  }).widenedTier
}

/**
 * #2891 AC-2 — the cap-3 ceiling only binds when the caller has opted into the XS/S profile
 * (its narrower 5-boolean affinity shape); a legacy-affinity train stays on the Standard bound
 * even when every member happens to be low-risk.
 */
function effectiveTrainLimits(
  root: string,
  ship: ShipConfig | undefined,
  opts: TaskShipOptions,
  state: UnifiedTaskState | null,
): TrainLimits {
  const usesXsProfile = opts.trainAffinity !== undefined && !isLegacyAffinity(opts.trainAffinity)
  const tier = usesXsProfile
    ? widestTrainTier(root, opts, state, opts.now ?? new Date())
    : undefined
  return trainLimitsFor(ship, opts, tier)
}

function shipSeedPatch(
  opts: TaskShipOptions,
  taskId: string | undefined,
  chainIds: string[] | undefined,
): TaskStatePatch {
  return {
    ...(taskId !== undefined ? { taskId } : {}),
    ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
    ...(opts.overrides !== undefined ? { overrides: opts.overrides } : {}),
    ...(chainIds !== undefined ? { chainIds } : {}),
  }
}

function seedShipState(root: string, opts: TaskShipOptions, limits: TrainLimits): void {
  const taskId = opts.taskId !== undefined ? normalizeShipTaskId(opts.taskId) : undefined
  // #2102 — same numeric-only guard as the primary id (rejects non-numeric ids loudly).
  const chainIds = opts.chainIds !== undefined ? opts.chainIds.map(normalizeChainId) : undefined
  const existing = readUnifiedState(root)
  assertSeedWithinLimit(existing, taskId, chainIds, limits)
  const patch = shipSeedPatch(opts, taskId, chainIds)
  if (existing === null || Object.keys(patch).length > 0) writeUnifiedState(root, patch)
}

function shipProfileFor(root: string, opts: TaskShipOptions): ShipProfile {
  return (
    opts.profileOverride ??
    resolveShipProfile(root, {
      ...(opts.autonomy !== undefined ? { autonomyOverride: opts.autonomy } : {}),
      ...(opts.overrides !== undefined ? { overrides: opts.overrides } : {}),
    })
  )
}

function advanceShipPhase(
  root: string,
  phase: TaskPhase,
  opts: TaskShipOptions,
  taskId: string | undefined,
  profile: ShipProfile,
): {
  phase: TaskPhase
  advanced: boolean
  review: PlannedReviewRound | null
  stopMessage: string | null
} {
  if (!opts.advance) return { phase, advanced: false, review: null, stopMessage: null }
  let current = phase
  let target = nextPhase(current)
  let review: PlannedReviewRound | null = null
  while (target !== null) {
    try {
      review = runTaskAdvance({
        to: target,
        dir: root,
        ...(opts.advanceOpts ?? {}),
        ...(opts.headSha !== undefined ? { headSha: opts.headSha } : {}),
      })
    } catch (error: unknown) {
      if (current === phase) throw error
      const reason = error instanceof Error ? error.message : String(error)
      const stopMessage = `advanced to ${current}; next gate (${target}) not yet satisfied: ${reason}`
      appendLog(root, `ship → ${stopMessage}`)
      return { phase: current, advanced: true, review, stopMessage }
    }
    appendLog(root, `ship → advanced to ${target}`)
    writeVerificationCompanionEvidence(root, target, taskId, profile, opts)
    current = target
    // GREEN is the implementation checkpoint. A single invocation that admits RED evidence must
    // return control to the implementer before the passing-test gate can freeze a candidate.
    if (current === 'green') {
      return { phase: current, advanced: true, review, stopMessage: null }
    }
    target = nextPhase(current)
  }
  return { phase: current, advanced: current !== phase, review, stopMessage: null }
}

function companionEvidencePath(taskId: string, repoDir: string): string {
  return join(repoDir, '.arbiter', 'evidence', 'companions', `${taskId}.json`)
}

function writeCompanionEvidence(
  root: string,
  taskId: string,
  profile: ShipProfile,
  opts: TaskShipOptions,
): string | null {
  if (profile.isArbiterSelf || profile.companions.length === 0) return null
  const evidence: CompanionEvidenceV1 = {
    $schemaVersion: 1,
    companions: profile.companions.map((c) => ({ id: c.id, mode: c.mode })),
    // #2373: minimal CI has no developer-home companion skills, so real diff collection is unselected.
    /* v8 ignore next */
    diffStats: (opts.gatherCompanionDiffStats ?? gatherCompanionDiffStats)(root),
    recordedAt: opts.recordedAt ?? new Date().toISOString(),
  }
  const parsed = CompanionEvidenceV1.safeParse(evidence)
  if (!parsed.success) {
    throw new Error(`Invalid companion evidence: ${parsed.error.message}`)
  }
  const out = companionEvidencePath(taskId, root)
  ensureDir(join(root, '.arbiter', 'evidence', 'companions'))
  writeFileTranslated(out, `${JSON.stringify(parsed.data, null, 2)}\n`)
  return out
}

// #2373: minimal CI has no developer-home companion skills, so this Git evidence path is unreachable.
/* v8 ignore start */
function gatherCompanionDiffStats(repoDir: string): CompanionDiffStats {
  const base = diffBase(repoDir)
  const range = base ? `${base}...HEAD` : 'HEAD'
  try {
    return parseShortstat(runCli('git', ['diff', '--shortstat', range], { cwd: repoDir }).stdout)
    // FAIL-OPEN-INTENT: companion diff stats are supplemental evidence; a missing git base must not block /ship.
  } catch {
    return { files: 0, insertions: 0, deletions: 0 }
  }
}

function diffBase(repoDir: string): string | null {
  for (const ref of ['origin/main', 'main']) {
    try {
      return runCli('git', ['merge-base', 'HEAD', ref], { cwd: repoDir }).stdout.trim()
      // FAIL-OPEN-INTENT: companion diff base discovery is best-effort; try the next local base ref.
    } catch {
      // Try the next local base ref; evidence remains best-effort when no base exists.
    }
  }
  return null
}

function parseShortstat(shortstat: string): CompanionDiffStats {
  const files = Number((shortstat.match(/(\d+) files? changed/) ?? [])[1] ?? 0)
  const insertions = Number((shortstat.match(/(\d+) insertions?\(\+\)/) ?? [])[1] ?? 0)
  const deletions = Number((shortstat.match(/(\d+) deletions?\(-\)/) ?? [])[1] ?? 0)
  return { files, insertions, deletions }
}
/* v8 ignore stop */

function writeVerificationCompanionEvidence(
  root: string,
  phase: TaskPhase,
  taskId: string | undefined,
  profile: ShipProfile,
  opts: TaskShipOptions,
): void {
  if (phase !== 'verification' || taskId === undefined) return
  writeCompanionEvidence(root, taskId, profile, opts)
}

function requestedShipTier(opts: TaskShipOptions, state: UnifiedTaskState | null): ShipTier {
  return normTier(opts.tier ?? state?.treatment?.requestedTier ?? state?.tier)
}

function shipPrimaryId(opts: TaskShipOptions, state: UnifiedTaskState | null): string | undefined {
  return opts.taskId === undefined ? state?.taskId : normalizeShipTaskId(opts.taskId)
}

function shipTreatmentFor(
  root: string,
  state: ReturnType<typeof readUnifiedState>,
  opts: TaskShipOptions,
  // #2891 AC-3 — an eject drops the prior treatment as a widening floor: `resolvedTier`
  // otherwise preserves whatever tier a since-dropped member widened the train to.
  ejected = false,
): ShipTreatment {
  const signals = (opts.gatherTierSignals ?? gatherTierSignals)(
    root,
    state?.taskId ?? opts.taskId,
    state?.plan,
  )
  return resolveShipTreatment(
    requestedShipTier(opts, state),
    {
      ...signals,
      ...(opts.executionOutcome !== undefined ? { executionOutcome: opts.executionOutcome } : {}),
    },
    ejected ? undefined : state?.treatment,
  )
}

/**
 * Compute (and optionally advance to) the current ship step. Returns the step descriptor the agent
 * loop should execute next. With `advance`, advances one phase via runTaskAdvance — gate-green is
 * enforced by the underlying gates (a red gate throws and is surfaced to the caller).
 */
/**
 * Validate every chain seed, replacement, and append before it can mutate task state.
 *
 * Runs BEFORE `seedShipState` so a refused append leaves the document exactly as it was: a
 * sealed train must not half-apply. Throws rather than returning a verdict because every caller
 * must stop when admission fails.
 *
 * Each candidate resolves from `XS`, never from the train's current tier: the question is whether
 * that issue is independently risk-bearing.
 */
interface TrainSignalInput {
  state: UnifiedTaskState | null
  now: Date
  additions: readonly string[]
  chainSize: number
}

function primaryTrainTier(
  root: string,
  opts: TaskShipOptions,
  state: UnifiedTaskState | null,
): { tier: ShipTier; planPath: string | undefined } {
  const gather = opts.gatherTierSignals ?? gatherTierSignals
  const primaryId = shipPrimaryId(opts, state)
  const taskChanged = shipTaskChanged(state, primaryId)
  const planPath = taskChanged ? undefined : state?.plan
  const tier = hasShipTaskId(primaryId)
    ? resolveShipTreatment(
        requestedShipTier(opts, state),
        gather(root, primaryId, planPath),
        taskChanged ? undefined : state?.treatment,
      ).tier
    : 'XS'
  return { tier, planPath }
}

/**
 * #2891 AC-1 — `disjointFiles` is computed from plan manifests for the XS/S profile, never
 * read from `--affinity` JSON (`parseTrainAffinity` already refuses that key at the CLI
 * boundary). A caller-supplied value (the `runTaskShip` programmatic seam — tests, or a future
 * non-CLI caller) wins and is never overridden, same trust boundary as the other affinity
 * booleans. Legacy-shaped affinity never touches this: the field does not exist on that profile.
 */
function affinityWithComputedDisjointFiles(
  root: string,
  affinity: TrainAffinitySignals,
  primary: { taskId: string | undefined; planPath: string | undefined },
  existingIds: readonly string[],
  additions: readonly string[],
): TrainAffinitySignals {
  if (isLegacyAffinity(affinity) || affinity.disjointFiles !== undefined) return affinity
  const memberIds = [
    ...new Set([
      ...(hasShipTaskId(primary.taskId) ? [primary.taskId as string] : []),
      ...existingIds,
      ...additions,
    ]),
  ]
  const planPaths = memberIds.map((id) =>
    id === primary.taskId && primary.planPath !== undefined
      ? primary.planPath
      : resolvePlanPath(id.replace(/^#/, ''), undefined),
  )
  return { ...affinity, disjointFiles: disjointFilesFor(root, planPaths) }
}

function trainSignalsFor(
  root: string,
  opts: TaskShipOptions,
  input: TrainSignalInput,
): TrainSignals {
  const gather = opts.gatherTierSignals ?? gatherTierSignals
  const primary = primaryTrainTier(root, opts, input.state)
  const primaryId = shipPrimaryId(opts, input.state)
  return {
    // The primary id rides the same branch, gate and PR, so it counts toward the bound.
    chainSize: input.chainSize,
    openedAt: input.state?.timestamps.chainOpened,
    now: input.now,
    // Resolve every candidate through the same fail-closed treatment as /ship.
    widenedTier: input.additions.reduce<ShipTier>((acc, raw) => {
      const tier = resolveShipTreatment(
        'XS',
        gather(root, normalizeChainId(raw), primary.planPath),
      ).tier
      return tier === 'Standard' || acc === 'Standard' ? 'Standard' : tier === 'S' ? 'S' : acc
    }, primary.tier),
    explicitSeal: opts.seal === true,
    ...(opts.trainAffinity !== undefined
      ? {
          affinity: affinityWithComputedDisjointFiles(
            root,
            opts.trainAffinity,
            { taskId: primaryId, planPath: primary.planPath },
            input.state?.chainIds ?? [],
            input.additions,
          ),
        }
      : {}),
  }
}

interface ChainAddContext {
  signalState: UnifiedTaskState | null
  additions: readonly string[]
  currentSize: number
  projectedSize: number
  /** #2891 AC-3 — chained ids dropped by a `--chain` re-declare that no longer names them. */
  ejected: readonly string[]
}

/** #2891 AC-3 — ids a `--chain` re-declare drops by no longer naming them; `[]` on a plain append. */
function ejectedIds(
  existing: readonly string[],
  replacement: readonly string[] | undefined,
): readonly string[] {
  if (replacement === undefined) return []
  return existing.filter((id) => !replacement.includes(id))
}

function chainAddContext(opts: TaskShipOptions, state: UnifiedTaskState | null): ChainAddContext {
  const taskId = shipPrimaryId(opts, state)
  const taskChanged = shipTaskChanged(state, taskId)
  const signalState = taskChanged ? null : state
  const existing = signalState?.chainIds ?? []
  const replacement = opts.chainIds?.map(normalizeChainId)
  const base = replacement ?? existing
  const chainAddIds = opts.chainAddIds ?? []
  const additions = appendChainIds([], [...(replacement ?? []), ...chainAddIds])
  const primaryCount = hasShipTaskId(taskId) ? 1 : 0
  return {
    signalState,
    additions,
    currentSize: primaryCount + (replacement === undefined ? existing.length : 0),
    projectedSize: primaryCount + appendChainIds(base, chainAddIds).length,
    ejected: ejectedIds(existing, replacement),
  }
}

/**
 * #2891 AC-3 — a re-declare may DROP members (eject) or ADD members (grow), never both in one
 * call: dropping one while adding a genuinely new one is a swap, and a swap is refused so an
 * eject can never smuggle in an unproven id under cover of a shrink.
 */
function assertNoTrainSwap(
  ejected: readonly string[],
  additions: readonly string[],
  existing: readonly string[],
): void {
  if (ejected.length === 0) return
  const grown = additions.some((id) => !existing.includes(id))
  if (!grown) return
  const detail =
    'a --chain re-declare cannot drop and add members in the same call; eject alone (re-declare without the id) or grow alone (--chain-add)'
  throw new UserFacingError(t('errors.E_TRAIN_SWAP_REFUSED', { detail }))
}

function assertChainAddAllowed(
  root: string,
  opts: TaskShipOptions,
  state: UnifiedTaskState | null,
  now: Date,
  limits: TrainLimits,
): AffinityVerdict {
  const { signalState, additions, currentSize, projectedSize, ejected } = chainAddContext(
    opts,
    state,
  )
  const existingIds = signalState?.chainIds ?? []
  // #2891 AC-3 — a pure eject only shrinks the chain: it cannot widen risk or exceed a cap, so
  // it is accepted without re-running the growth seal (max-age in particular would otherwise
  // refuse the very re-declare a REWORK round needs to drop a member).
  if (ejected.length > 0 && additions.every((id) => existingIds.includes(id))) {
    return {
      decision: 'JOIN',
      components: opts.trainAffinity ?? evaluateAffinity(undefined).components,
      reason: 'member ejected on --chain re-declare',
      ejected: [...ejected],
    }
  }
  const signals = trainSignalsFor(root, opts, {
    state: signalState,
    now,
    additions,
    chainSize: currentSize,
  })
  const currentVerdict = evaluateSeal(signals, limits)
  if (currentVerdict.sealed) {
    // UserFacingError, not Error: a seal is the policy working as designed, not a fault. The
    // generic handler would print "Unexpected error", telling the operator something broke.
    const seal = { reason: currentVerdict.reason, detail: currentVerdict.detail }
    throw new UserFacingError(t('errors.E_TRAIN_SEALED', seal))
  }
  if (projectedSize <= limits.maxChain) {
    // A swap (drop one, add a genuinely new one) only matters once the affinity/growth seal has
    // already passed — a swap onto a broken affinity is refused for the affinity reason first,
    // matching the plain-replacement seal an operator already expects.
    assertNoTrainSwap(ejected, additions, existingIds)
    const affinity = evaluateAffinity(opts.trainAffinity, { widestTier: signals.widenedTier })
    return ejected.length > 0 ? { ...affinity, ejected: [...ejected] } : affinity
  }
  const seal = {
    reason: 'max-chain' as const,
    detail: `the requested append would make the train carry ${projectedSize} issue(s), the limit is ${limits.maxChain}`,
  }
  throw new UserFacingError(t('errors.E_TRAIN_SEALED', seal))
}

interface PreparedChainAdd {
  additions: readonly string[]
  now: Date
  affinity: AffinityVerdict
}

function prepareChainAdd(
  root: string,
  opts: TaskShipOptions,
  limits: TrainLimits,
  state: UnifiedTaskState | null,
): PreparedChainAdd | null {
  const additions = chainAddContext(opts, state).additions
  if (additions.length === 0 && opts.seal !== true) return null

  const now = opts.now ?? new Date()
  const affinity = assertChainAddAllowed(root, opts, state, now, limits)
  return { additions, now, affinity }
}

/** Persist an accepted append. Split from the decision so each half stays legible. */
function persistTrainAppend(
  root: string,
  state: UnifiedTaskState | null,
  additions: readonly string[],
  now: Date,
  affinity: AffinityVerdict,
): void {
  const existing = state?.chainIds ?? []
  const chainIds = appendChainIds(existing, additions)
  const ejected = (affinity.ejected?.length ?? 0) > 0
  writeUnifiedState(root, {
    chainIds,
    // Stamp the open time on the first append only; `timestamps` is shallow-merged, so this
    // never disturbs the phase-transition stamps sharing the map.
    ...(state?.timestamps.chainOpened === undefined
      ? { timestamps: { chainOpened: now.toISOString() } }
      : {}),
    // #2891 AC-3 — an eject drops the freeze marker (not the round budget) so the narrowed
    // train re-freezes on the next round instead of replaying a review pinned to the wider one.
    ...(ejected ? { review: { ...reviewStateOf(state), lastReviewedSha: null } } : {}),
  })
  if (ejected) appendLog(root, 'ship → train re-freezes: review marker cleared after eject')
  appendLog(root, `ship → train +${chainIds.length - existing.length} (${chainIds.join(', ')})`)
  appendLog(
    root,
    `ship → ${affinity.decision} ${affinity.reason} components=${JSON.stringify(affinity.components)}`,
  )
}

/** #2891 AC-3 — true when this run's chain-add verdict ejected a member (drives the treatment reset). */
function chainAddEjected(prepared: PreparedChainAdd | null): boolean {
  return (prepared?.affinity.ejected?.length ?? 0) > 0
}

function applyPreparedChainAdd(root: string, prepared: PreparedChainAdd | null): void {
  if (prepared === null) return
  persistTrainAppend(
    root,
    readUnifiedState(root),
    prepared.additions,
    prepared.now,
    prepared.affinity,
  )
}

interface ExplicitReviewRoundResult {
  plan: PlannedReviewRound | null
  summary?: string
  note?: string
}

function reviewCompletionExitCode(root: string, taskId: string): number {
  try {
    runCli('node', [join(root, 'scripts', 'check-review-completion.mjs'), '--task', taskId], {
      cwd: root,
      timeoutMs: 30_000,
      retries: 0,
    })
    return 0
  } catch (error) {
    if (error instanceof CliError) return error.exitCode
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findingSeverity(finding: Record<string, unknown>): string {
  return typeof finding.severity === 'string' ? finding.severity : ''
}

function blockingFindingCount(findings: readonly Record<string, unknown>[]): number {
  return findings.filter((finding) =>
    ['critical', 'high', 'med'].includes(findingSeverity(finding)),
  ).length
}

function firstFindingCitation(
  finding: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!Array.isArray(finding.citations)) return undefined
  return isRecord(finding.citations[0]) ? finding.citations[0] : undefined
}

function lowFindingNote(root: string, finding: Record<string, unknown>): TaskNoteOptions | null {
  if (findingSeverity(finding) !== 'low') return null
  const claim = typeof finding.claim === 'string' ? finding.claim.trim() : ''
  if (claim.length === 0) return null
  const firstCitation = firstFindingCitation(finding)
  return {
    note: claim,
    kind: 'note',
    severity: 'low',
    dir: root,
    ...(typeof firstCitation?.file === 'string' ? { file: firstCitation.file } : {}),
    ...(typeof firstCitation?.line === 'number' && Number.isInteger(firstCitation.line)
      ? { line: firstCitation.line }
      : {}),
  }
}

function spoolLowFindings(root: string, findings: readonly Record<string, unknown>[]): void {
  for (const finding of findings) {
    const note = lowFindingNote(root, finding)
    if (note === null) continue
    const result = runTaskNote(note)
    if (!result.ok) {
      throw new FatalError(
        'E_REVIEW_FINDING_SPOOL',
        `review finding could not be recorded: ${result.reason}`,
      )
    }
  }
}

function noReviewData(plan: PlannedReviewRound, detail: string): FatalError {
  return new FatalError(
    'E_REVIEW_NO_DATA',
    `review round ${plan.rounds}: Codex reviewer returned no data (${detail}); no envelope was written and the round remains open`,
  )
}

interface ExecuteCodexReviewRoundOptions {
  root: string
  plan: PlannedReviewRound
  opts: TaskShipOptions
  profile: ShipProfile
  treatment: ShipTreatment
  vertical: string
}

function codexReviewContext(
  root: string,
  profile: ShipProfile,
  plan: PlannedReviewRound,
): { taskId: string; planRef: string; cfg: NonNullable<ShipProfile['crossModelReview']> } {
  const state = readUnifiedState(root)
  const taskId = state?.taskId
  if (taskId === undefined) throw noReviewData(plan, 'active task id is missing')
  const planRef = state?.plan
  if (planRef === undefined) throw noReviewData(plan, 'frozen plan reference is missing')
  const cfg = profile.crossModelReview
  if (cfg === undefined) throw noReviewData(plan, 'cross-model review not configured')
  return { taskId, planRef, cfg }
}

function invokeCodexReviewRound(
  input: ExecuteCodexReviewRoundOptions,
  taskId: string,
  planRef: string,
  cfg: NonNullable<ShipProfile['crossModelReview']>,
): ReturnType<typeof runShipCrossModelReview> {
  const { root, plan, opts, profile, treatment, vertical } = input
  try {
    return runShipCrossModelReview({
      dir: root,
      taskId,
      tier: treatment.tier,
      phase: 'refactor',
      vertical,
      cfg,
      baseSha: plan.base,
      headSha: plan.head,
      planRef,
      treatment,
      collaborationMode: profile.collaborationMode,
      ...(opts.externalModelAccess !== undefined ? { access: opts.externalModelAccess } : {}),
    })
  } catch (error) {
    throw noReviewData(plan, error instanceof Error ? error.message : String(error))
  }
}

function fulfilledReviewEnvelope(
  result: ReturnType<typeof runShipCrossModelReview>,
  plan: PlannedReviewRound,
): NonNullable<typeof result.envelope> {
  if (result.status !== 'fulfilled' || !result.recorded || result.envelope === undefined) {
    const reasons = result.degradationReasons.join(', ') || 'empty reviewer result'
    throw noReviewData(
      plan,
      result.rejectionDetail === undefined ? reasons : `${reasons}: ${result.rejectionDetail}`,
    )
  }
  return result.envelope
}

function reviewNextAction(blocking: number, completion: number, findingCount: number): string {
  if (blocking > 0 || completion !== 0) return 'rework'
  return findingCount > 0 ? 'parked' : 'advance'
}

// #2865 — name every acceptance criterion the reviewer did not PASS, in envelope order.
function nonPassSuffix(fit: Record<string, unknown>): string {
  const criteria: unknown[] = Array.isArray(fit['criteria']) ? fit['criteria'] : []
  const open = criteria
    .map((c) => (c ?? {}) as { id?: unknown; verdict?: unknown })
    .filter((c) => c.verdict !== 'PASS')
    .map((c) => `${String(c.id)} ${String(c.verdict)}`)
  return open.length === 0 ? '' : ` · non-PASS: ${open.join(', ')}`
}

function executeCodexReviewRound(input: ExecuteCodexReviewRoundOptions): string {
  const { root, plan, profile } = input
  const { taskId, planRef, cfg } = codexReviewContext(root, profile, plan)
  const envelope = fulfilledReviewEnvelope(
    invokeCodexReviewRound(input, taskId, planRef, cfg),
    plan,
  )
  const findings = envelope.findings
  spoolLowFindings(root, findings)
  const completion = reviewCompletionExitCode(root, taskId)
  if (completion === 2) throw noReviewData(plan, 'review completion check errored')
  const blocking = blockingFindingCount(findings)
  const next = reviewNextAction(blocking, completion, findings.length)
  return `review round ${plan.rounds}: ${envelope.verdict} — ${findings.length} findings (${blocking} blocking) · next: ${next}${nonPassSuffix(envelope.acceptanceFit)}`
}

function configuredCodexSeat(profile: ShipProfile, treatment: ShipTreatment): boolean {
  const cfg = profile.crossModelReview
  return (
    cfg?.enabled === true &&
    cfg.diffEgressConsent &&
    cfg.providers.includes('codex') &&
    cfg.slots.codeReview > 0 &&
    treatment.tier === 'Standard' &&
    treatment.finalReviewers > 0
  )
}

function reviewSlotPlan(
  opts: TaskShipOptions,
  profile: ShipProfile,
  treatment: ShipTreatment,
): ReturnType<typeof planCrossModelSlots> {
  return planCrossModelSlots({
    tier: treatment.tier,
    phase: 'refactor',
    totalSlots: treatment.finalReviewers,
    verticals: treatment.reviewerVerticals,
    ...(profile.crossModelReview !== undefined ? { cfg: profile.crossModelReview } : {}),
    ...(opts.externalModelAccess !== undefined ? { access: opts.externalModelAccess } : {}),
  })
}

function reviewRoundOptions(
  root: string,
  opts: TaskShipOptions,
  retryIncomplete: boolean,
): Parameters<typeof runTaskReviewRound>[0] {
  return {
    dir: root,
    ...(opts.forceReview !== undefined ? { forceReview: opts.forceReview } : {}),
    ...(opts.reviewMaxRounds !== undefined ? { reviewMaxRounds: opts.reviewMaxRounds } : {}),
    ...(opts.headSha !== undefined ? { headSha: opts.headSha } : {}),
    ...(retryIncomplete ? { retryIncomplete: true } : {}),
  }
}

function reviewVertical(
  slotPlan: ReturnType<typeof planCrossModelSlots>,
  treatment: ShipTreatment,
): string {
  return slotPlan.external[0] ?? treatment.reviewerVerticals[0] ?? 'bugs'
}

// #2910 AC-4 — with no seat the runtime dispatches nobody; say so before the panel template.
const REVIEW_ROUND_NO_SEAT =
  'review round: no reviewer dispatched — no reviewer seat is configured; the round waits for an independent reviewer envelope'

const REVIEW_ROUND_NOT_OPENED =
  'review round: not opened — the latest review already covers this source (no blocking findings, no source change since)'

function openExplicitReviewRound(
  root: string,
  opts: TaskShipOptions,
  profile: ShipProfile,
  treatment: ShipTreatment,
): ExplicitReviewRoundResult {
  if (opts.reviewRound !== true) return { plan: null }
  const hasCodexSeat = configuredCodexSeat(profile, treatment)
  const slotPlan = reviewSlotPlan(opts, profile, treatment)
  const plan = runTaskReviewRound(reviewRoundOptions(root, opts, hasCodexSeat))
  // #2850 — say so when no round opens; a silent no-op reads as a completed review.
  if (plan === null) return { plan, summary: REVIEW_ROUND_NOT_OPENED }
  if (!hasCodexSeat && slotPlan.external.length === 0) return { plan, note: REVIEW_ROUND_NO_SEAT }
  return {
    plan,
    summary: executeCodexReviewRound({
      root,
      plan,
      opts,
      profile,
      treatment,
      vertical: reviewVertical(slotPlan, treatment),
    }),
  }
}

function assertShipNotBlocked(
  state: UnifiedTaskState | null,
  outcome: ShipExecutionOutcome | undefined,
): void {
  const blocked = state?.treatment?.reasons.some((reason) => reason.startsWith('BLOCKED:'))
  if (blocked === true && outcome !== 'new-risk') {
    throw new UserFacingError(t('errors.E_NO_PROGRESS_BLOCKED'))
  }
}

function matchesShipTask(state: UnifiedTaskState, requestedTaskId: string | undefined): boolean {
  return requestedTaskId === undefined || normalizeShipTaskId(requestedTaskId) === state.taskId
}

function hasShipLifecycleMutation(opts: TaskShipOptions): boolean {
  return Boolean(
    opts.advance || opts.reviewRound || opts.forceReview || opts.seal || opts.premortem,
  )
}

function hasShipProfileMutation(opts: TaskShipOptions): boolean {
  return opts.tier !== undefined || opts.autonomy !== undefined || opts.overrides !== undefined
}

function hasShipTrainMutation(opts: TaskShipOptions): boolean {
  return (
    opts.chainIds !== undefined ||
    opts.chainAddIds !== undefined ||
    opts.trainAffinity !== undefined ||
    opts.executionOutcome !== undefined
  )
}

function isReadOnlyShipRequest(
  state: UnifiedTaskState | null,
  opts: TaskShipOptions,
): state is UnifiedTaskState {
  return (
    state !== null &&
    matchesShipTask(state, opts.taskId) &&
    !hasShipLifecycleMutation(opts) &&
    !hasShipProfileMutation(opts) &&
    !hasShipTrainMutation(opts)
  )
}

const PUBLIC_API_COUNT_SCRIPT = [
  "import { pathToFileURL } from 'node:url'",
  'const { countPublicApi } = await import(pathToFileURL(process.argv[1]).href)',
  'process.stdout.write(String(countPublicApi(process.cwd())))',
].join('\n')

/** #2863 AC-2 — the plan step shows the public API count the preflight ratchet will compare. */
function planDebtCurrent(
  root: string,
  phase: TaskPhase,
  tier: ShipTier,
): Record<string, number> | undefined {
  if (phase !== 'plan' || tier !== 'Standard') return undefined
  try {
    const stdout = runCli(
      'node',
      ['--input-type=module', '-e', PUBLIC_API_COUNT_SCRIPT, join(root, 'scripts', 'debt-lib.mjs')],
      { cwd: root, timeoutMs: 5000 },
    ).stdout
    const count = Number(stdout)
    return Number.isInteger(count) ? { publicApiSurface: count } : undefined
    // FAIL-OPEN-INTENT: the count is a plan-time hint; without it the line says "not measured at plan" and preflight still gates the ratchet.
  } catch {
    return undefined
  }
}

function readOnlyShipResult(
  root: string,
  state: UnifiedTaskState,
  opts: TaskShipOptions,
): ShipResult {
  const treatment = resolveShipTreatment(
    requestedShipTier(opts, state),
    {
      blastRadius: null,
      labels: [],
      milestoneBundled: false,
      complete: false,
    },
    state.treatment,
  )
  const profile = shipProfileFor(root, opts)
  return {
    phase: state.phase,
    step: shipStepFor(state.phase, treatment, profile, state.taskId, {
      chainIds: state.chainIds ?? [],
      ...(state.plan ? { plan: state.plan } : {}),
    }),
    advanced: false,
    done: state.phase === 'complete',
    tier: treatment.tier,
    treatment,
    checkpoint: {
      cursor: state.cursor,
      ...(state.review ? { review: state.review } : {}),
    },
    ...(state.derivedGates ? { derivedGates: state.derivedGates } : {}),
    ...optionalDebtCurrent(root, state.phase, treatment.tier),
    profile,
  }
}

function optionalDebtCurrent(
  root: string,
  phase: TaskPhase,
  tier: ShipTier,
): Pick<ShipResult, 'debtCurrent'> {
  const debtCurrent = planDebtCurrent(root, phase, tier)
  return debtCurrent ? { debtCurrent } : {}
}

function persistShipTreatment(
  root: string,
  state: UnifiedTaskState | null,
  treatment: ShipTreatment,
): void {
  if (
    state?.tier !== treatment.tier ||
    JSON.stringify(state.treatment) !== JSON.stringify(treatment)
  ) {
    writeUnifiedState(root, { tier: treatment.tier, treatment })
  }
}

/**
 * #2890 AC-1 — printed only at the `plan` step, from the manifest + already-resolved treatment
 * (never file contents). `--premortem` forces `required` (AC-3). #2899: the decision is never
 * persisted; only the sticky `premortemForced` input is, so a later freeze honours it.
 */
function premortemFor(
  root: string,
  phase: TaskPhase,
  state: UnifiedTaskState | null,
  treatment: ShipTreatment,
  opts: TaskShipOptions,
): PremortemDecision | undefined {
  const forced = opts.premortem === true || state?.premortemForced === true
  if (forced && state?.premortemForced !== true) writeUnifiedState(root, { premortemForced: true })
  if (phase !== 'plan') return undefined
  const manifest = readPlanManifest(root, state?.plan)
  return evaluatePremortem(manifest ? [...manifest] : [], treatment, forced ? { force: true } : {})
}

function optionalReviewText(
  reviewSummary: string | undefined,
  reviewNote: string | undefined,
): Pick<ShipResult, 'reviewSummary' | 'reviewNote'> {
  return {
    ...(reviewSummary !== undefined ? { reviewSummary } : {}),
    ...(reviewNote !== undefined ? { reviewNote } : {}),
  }
}

function buildActiveShipResult(input: {
  root: string
  phase: TaskPhase
  treatment: ShipTreatment
  profile: ShipProfile
  state: UnifiedTaskState | null
  advanced: boolean
  preparedRound: PlannedReviewRound | null
  reviewSummary: string | undefined
  reviewNote: string | undefined
  stopMessage: string | null
  preparedChainAdd: ReturnType<typeof prepareChainAdd>
  opts: TaskShipOptions
  premortem: PremortemDecision | undefined
}): ShipResult {
  const {
    root,
    phase,
    treatment,
    profile,
    state,
    advanced,
    preparedRound,
    reviewSummary,
    reviewNote,
    stopMessage,
    preparedChainAdd,
    opts,
    premortem,
  } = input
  const step = shipStepFor(phase, treatment, profile, state?.taskId, {
    chainIds: state?.chainIds ?? [],
    ...(state?.plan ? { plan: state.plan } : {}),
    ...(opts.externalModelAccess !== undefined
      ? { externalModelAccess: opts.externalModelAccess }
      : {}),
    ...(preparedRound !== null ? { review: preparedRound } : {}),
  })
  const reviewSubject = reviewSubjectFor(root, state, preparedRound)
  return {
    phase,
    step: stopMessage === null ? step : { ...step, action: stopMessage },
    advanced,
    reviewDispatched: preparedRound !== null,
    ...optionalReviewText(reviewSummary, reviewNote),
    ...(reviewSubject !== undefined ? { reviewSubject } : {}),
    done: phase === 'complete',
    tier: treatment.tier,
    treatment,
    ...(state?.derivedGates ? { derivedGates: state.derivedGates } : {}),
    ...optionalDebtCurrent(root, phase, treatment.tier),
    ...(preparedChainAdd !== null ? { trainDecision: preparedChainAdd.affinity } : {}),
    ...(premortem !== undefined ? { premortem } : {}),
    profile,
  }
}

function reviewSubjectFor(
  root: string,
  state: UnifiedTaskState | null,
  round: PlannedReviewRound | null,
): ShipResult['reviewSubject'] {
  if (round === null) return undefined
  if (!state?.taskId) throw new Error('planned review round has no task id')
  const liveBranch = runCli('git', ['branch', '--show-current'], {
    cwd: root,
    timeoutMs: 5000,
  }).stdout.trim()
  return {
    taskId: state.taskId,
    branch: (state.branch ?? liveBranch) || '<current-branch>',
    sha: round.head ?? '<frozen-sha>',
    criteriaIds: readFrozenAcceptanceIds(root, state.plan, round.head),
    criteriaCommand: `rg -n 'AC-' -- ${JSON.stringify(state.plan.split('#')[0])}`,
  }
}

const ACCEPTANCE_IDS_SCRIPT = [
  "import { readFileSync } from 'node:fs'",
  "import { pathToFileURL } from 'node:url'",
  'const { parsePlanAnchor } = await import(pathToFileURL(process.argv[1]).href)',
  "const anchor = parsePlanAnchor(readFileSync(0, 'utf8'))",
  'process.stdout.write(JSON.stringify(anchor?.criteria.map(({ id }) => id) ?? []))',
].join(';')

function readFrozenAcceptanceIds(root: string, planRef: string, sha: string | null): string[] {
  const plan = planRef.split('#')[0]?.trim() ?? ''
  if (plan.length === 0 || sha === null) return []
  try {
    const body = runCli('git', ['show', `${sha}:${plan}`], { cwd: root, timeoutMs: 5000 }).stdout
    const stdout = runCli(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        ACCEPTANCE_IDS_SCRIPT,
        join(root, 'scripts', 'lib', 'acceptance-criteria.mjs'),
      ],
      { cwd: root, input: body, timeoutMs: 5000 },
    ).stdout
    const parsed: unknown = JSON.parse(stdout)
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string' || id.length === 0)) {
      return []
    }
    return parsed as string[]
    // FAIL-OPEN-INTENT: the printed envelope is a hint; unreadable criteria print no entry and name the listing command, and the recorder still validates exact AC coverage.
  } catch {
    return []
  }
}

export function runTaskShip(opts: TaskShipOptions = {}): ShipResult {
  const root = opts.dir ?? process.cwd()
  assertShipHostBinding(root, opts.taskId, opts.isLinkedCheckout)
  const initialState = readUnifiedState(root)
  if (isReadOnlyShipRequest(initialState, opts)) {
    runTaskResume({ dir: root, write: () => undefined })
    return readOnlyShipResult(root, initialState, opts)
  }
  assertShipNotBlocked(initialState, opts.executionOutcome)
  const shipConfig = shipConfigFor(root)
  // Validate the complete train mutation before seeding task metadata. A rejected append must
  // leave both fresh and existing state untouched, including task/tier/override fields.
  const trainLimits = effectiveTrainLimits(root, shipConfig, opts, initialState)
  const preparedChainAdd = prepareChainAdd(root, opts, trainLimits, initialState)
  seedShipState(root, opts, trainLimits)
  applyPreparedChainAdd(root, preparedChainAdd)

  const state = readUnifiedState(root)
  let phase: TaskPhase = state?.phase ?? 'preflight'
  const treatment = shipTreatmentFor(root, state, opts, chainAddEjected(preparedChainAdd))
  persistShipTreatment(root, state, treatment)
  if (treatment.reasons.some((reason) => reason.startsWith('BLOCKED:'))) {
    appendLog(root, 'ship → BLOCKED: current implementation approach made no progress')
    throw new UserFacingError(t('errors.E_NO_PROGRESS_BLOCKED'))
  }

  // #1288 — resolve the profile from the TARGET repo's arbiter.json so steps are config-aware
  // and self-only authoring gates are skipped in a consumer repo.
  const profile = shipProfileFor(root, opts)
  const explicitRound = openExplicitReviewRound(root, opts, profile, treatment)
  const advancedPhase = advanceShipPhase(root, phase, opts, state?.taskId, profile)
  phase = advancedPhase.phase
  const preparedRound = explicitRound.plan ?? advancedPhase.review
  writeVerificationCompanionEvidence(root, phase, state?.taskId, profile, opts)
  const premortem = premortemFor(root, phase, state, treatment, opts)

  return buildActiveShipResult({
    root,
    phase,
    treatment,
    profile,
    state,
    advanced: advancedPhase.advanced,
    preparedRound,
    reviewSummary: explicitRound.summary,
    reviewNote: explicitRound.note,
    stopMessage: advancedPhase.stopMessage,
    preparedChainAdd,
    opts,
    premortem,
  })
}
