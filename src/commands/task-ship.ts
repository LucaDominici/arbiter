// SPDX-License-Identifier: Apache-2.0
//
// `arbiter ship <id>` (#1206) — the orchestrator.
//
// Drives an issue toward a reviewed, merged PR by auto-sequencing arbiter's EXISTING engine
// (worktree → plan → review-plan gate → TDD impl → review-code → verify → gate → merge → cleanup).
// This is the next-action COMPUTER + auto-advance-on-gate-green: it cannot itself write code or
// dispatch review subagents (those need the agent), so `arbiter ship` computes the next concrete
// step and advances the phase when its gate is green; the `/ship` slash command is the loop that
// executes the model-requiring steps between calls. Reuses runTaskAdvance + the existing gates.
import { ensureDir, writeFileTranslated } from '../utils/fs.js'
import { UserFacingError } from '../utils/errors.js'
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
  reviewStateOf,
  type UnifiedTaskState,
} from './task-state.js'
import { runTaskAdvance } from './task.js'
import { sanitizeTaskId } from '../worktree/paths.js'
import {
  autonomyAllows,
  type ShipProfile,
  CONSUMER_DEFAULT_PROFILE,
  SELF_ONLY_GATES,
  resolveShipProfile,
} from './ship-profile.js'
import { companionGreenInstruction, companionStatusLine } from '../integrations/companions.js'
import { runCli } from '../utils/run-cli.js'
import type { ExternalModelAccess } from '../detectors/external-model.js'
import { planCrossModelSlots } from '../integrations/external-review.js'
import {
  gatherTierSignals,
  normTier,
  widenTier,
  type ShipTier,
  type TierSignals,
} from './ship-tier.js'

export { type ShipTier } from './ship-tier.js'
import {
  appendChainIds,
  evaluateSeal,
  evaluateSeedSize,
  hasShipTaskId,
  resolveTrainLimits,
  shipTaskChanged,
  type TrainLimits,
  type TrainSignals,
} from './ship-train.js'
import { evaluateReviewRound, resolveReviewMaxRounds, reviewScopeLine } from './ship-review.js'
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

/** Pre-implementation red-team agents per tier (mirrors /task Phase 3.5; #2176 did not measure red-team). */
const REDTEAM_AGENTS: Record<ShipTier, number> = { XS: 1, S: 2, Standard: 3 }
/** #2178/#2176: post-implementation code-review agents per tier (mirrors /task Phase 6 minimums). */
const REVIEW_AGENTS: Record<ShipTier, number> = { XS: 1, S: 1, Standard: 2 }
/** #2178: a diff whose file-path-matched auditors include security/data-integrity/silent-failures
    escalates the code review to a panel (study: singles 82-83%, panels 97-99%). */
export const REVIEW_AGENTS_SECURITY_SURFACE = 3

/**
 * #1260's orthogonal vertical FLOOR, inlined (A8 — guidance, not machinery; the git-diff
 * auto-tiering `arbiter.sizing` subsystem it used to live in was pruned as 2025-era
 * machinery). Real `auditor-routing.json` auditor names, in stable widening order: XS is the
 * always-on triad, S adds test-quality, Standard adds the heavy verticals.
 */
const FLOOR_XS = ['bugs', 'type-safety', 'domain'] as const
const FLOOR_S_ADD = ['test-quality'] as const
const FLOOR_STD_ADD = ['security', 'data-integrity', 'silent-failures'] as const

export function verticalsForTier(tier: ShipTier): string[] {
  if (tier === 'XS') return [...FLOOR_XS]
  if (tier === 'S') return [...FLOOR_XS, ...FLOOR_S_ADD]
  return [...FLOOR_XS, ...FLOOR_S_ADD, ...FLOOR_STD_ADD]
}

export interface ShipStep {
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
  chainIds: readonly string[]
  verticals: readonly string[]
  externalModelAccess?: ExternalModelAccess
  /** #2400 — the review round this invocation opened, when it opened one. */
  review?: ReviewRoundPlan
}

type ShipStepTail = readonly string[] | Omit<ShipStepContext, 'verticals'>

function normalizeShipStepTail(tail: ShipStepTail): Omit<ShipStepContext, 'verticals'> {
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
  tier: string | undefined,
  profile: ShipProfile = CONSUMER_DEFAULT_PROFILE,
  /** #2102 — the primary task id, named alongside `chainIds` in the close-step text. */
  taskId?: string,
  /** #2102/#2357 — legacy chain array or the optional injected review context. */
  tail: ShipStepTail = [],
): ShipStep {
  const t = normTier(tier)
  const verticals = verticalsForTier(t)
  const normalizedTail = normalizeShipStepTail(tail)
  const withVerticals = (step: Omit<ShipStep, 'verticals'>): ShipStep => ({ ...step, verticals })
  return withVerticals(
    shipStepBody(phase, t, profile, {
      ...normalizedTail,
      verticals,
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
function greenAction(profile: ShipProfile): string {
  const base = 'Implement the minimum to make the tests pass.'
  const companion = companionGreenInstruction(profile.companions)
  return companion ? `${base} ${companion}` : base
}

/**
 * #A11 — CLOSER mode action for the `close` phase (last mile: merge, red gate, conflict).
 * Entry into this phase switches the active agent-rule set to `.claude/rules/95-closer-mode.md`:
 * single named target (no switching), no new issues/refactor beyond the diff (findings → PARKING,
 * one line, no action), same error twice → 5-line root-cause or declare BLOCKED, foreground waits
 * only (no background "monitor" for gate/PR checks), never end on a promise.
 */
function closeAction(): string {
  return (
    'CLOSER mode: single named target, no new issues or refactor beyond the diff ' +
    '(findings → PARKING list, one line, no action). Same error twice → 5-line root-cause, ' +
    'else declare BLOCKED. Commit the candidate, then run `node scripts/check-all.mjs L2` once before push. ' +
    'Foreground-wait on the PR/gate checks; never end the turn on a promise.'
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

type ReviewPhase = 'red-team-review' | 'red-team-rework' | 'refactor'
const RED_TEAM_REVIEW_PHASE: ReviewPhase = 'red-team-review'
const RED_TEAM_REWORK_PHASE: ReviewPhase = 'red-team-rework'
const REFACTOR_PHASE: ReviewPhase = 'refactor'

function isReviewPhase(phase: TaskPhase): phase is ReviewPhase {
  return (
    phase === RED_TEAM_REVIEW_PHASE || phase === RED_TEAM_REWORK_PHASE || phase === REFACTOR_PHASE
  )
}

/**
 * #2400 — the delta-scope annotation for a re-review, or undefined when there is nothing to
 * narrow: round 1 reads the whole change, and a round whose base sha is unknown has no range.
 */
function reviewScopeFor(plan: ReviewRoundPlan | undefined): string | undefined {
  if (plan === undefined || plan.rounds < 2 || plan.base === null) return undefined
  return reviewScopeLine(plan.base, plan.rounds, plan.maxRounds)
}

function reviewPhaseStepBody(
  phase: ReviewPhase,
  t: ShipTier,
  profile: ShipProfile,
  context: Pick<ShipStepContext, 'verticals' | 'externalModelAccess' | 'review'>,
): Omit<ShipStep, 'verticals'> {
  const { verticals, externalModelAccess, review: reviewPlan } = context
  if (phase === RED_TEAM_REVIEW_PHASE) {
    return {
      phase,
      action: `Dispatch ${REDTEAM_AGENTS[t]} red-team agent(s); route CRITICAL findings to red-team-rework.`,
      reviewAgents: REDTEAM_AGENTS[t],
    }
  }
  if (phase === RED_TEAM_REWORK_PHASE) {
    return {
      phase,
      action: 'Revise the plan for CRITICAL findings, then re-run red-team-review.',
      reviewAgents: 0,
    }
  }
  const reviewAgents = profile.collaborationMode === 'trunk-solo' ? 1 : REVIEW_AGENTS[t]
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
  const step: Omit<ShipStep, 'verticals'> = {
    phase,
    action:
      externalCount > 0
        ? `Clean up, then dispatch ${reviewAgents - externalCount} Anthropic code-review agent(s) + ${externalCount} Codex reviewer(s); panel total: ${reviewAgents}.`
        : `Clean up, then dispatch ${reviewAgents} code-review agent(s) + 1 adversarial verifier.`,
    reviewAgents,
    ...(scope !== undefined ? { reviewScope: scope } : {}),
  }
  return externalCount > 0 ? { ...step, externalReviewers: externalCount } : step
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

  switch (phase) {
    case 'preflight':
      return {
        phase,
        action: 'Open the worktree, read the issue, write task state.',
        command: 'arbiter task init --id <id> --tier <tier> --plan <path>',
        reviewAgents: 0,
      }
    case 'plan':
      return {
        phase,
        // #2329 — batching guidance is model-side prose (the wave-drain skill), not a
        // config knob: the affinity engine it keyed off was deleted in the #1817 B-prune.
        action: 'Write the plan, then pass the plan-review gate.',
        command: 'arbiter verify plan <plan-file>',
        reviewAgents: 0,
      }
    case 'red':
      return {
        phase,
        action: 'Write failing tests first (TDD red); record evidence.',
        command: 'arbiter task record-red --test-path <path>',
        reviewAgents: 0,
      }
    case 'green':
      return {
        phase,
        action: greenAction(profile),
        reviewAgents: 0,
      }
    case 'verification':
      return {
        phase,
        // #1306 — verification consumes profile.defaultGateLevel (resolved through the
        // unified resolver): the default gate run is the profile's level (L1/L2), not a
        // hard-coded one. A per-run `--set automation.defaultGateLevel=L2` raises it.
        action: `Run the ${profile.defaultGateLevel} gate; fix any failures.`,
        command: `node scripts/check-all.mjs ${profile.defaultGateLevel}`,
        reviewAgents: 0,
        // Self-only authoring gates run here for arbiter-self only; a consumer repo has no
        // such concern, so the list is empty (skipped, not faked — ADR-093 §5 / INV-115).
        selfOnlyChecks: verificationSelfOnlyChecks(profile),
      }
    case 'close':
      return {
        phase,
        action: closeAction(),
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

/**
 * The phase `--advance` moves to from `phase`. The lateral `red-team-rework` re-enters the
 * `red-team-review` gate; every other phase advances one step forward (null at the end).
 */
function advanceTargetFor(phase: TaskPhase): TaskPhase | null {
  if (phase === 'red-team-rework') return 'red-team-review'
  return nextPhase(phase)
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
  /** #1291 — per-run --autonomy override (flag > arbiter.json automation.autonomy > L0). */
  autonomy?: string
  /**
   * #1305 (ADR-094 §Decision.2) — generic per-run `--set <path>=<value>` overrides for this ship
   * invocation, gated by OVERRIDABLE_PATHS at the CLI boundary. Forwarded to resolveShipProfile.
   */
  overrides?: Record<string, string>
  /** Advance to the next phase first (runs that phase's gate; throws if the gate is red). */
  advance?: boolean
  /** Bubble handoff control-flow to the caller instead of being swallowed. */
  advanceOpts?: {
    skipPlanReview?: boolean
    postClear?: boolean
    units?: number
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
  gatherTierSignals?: (root: string, taskId: string | undefined) => TierSignals
  /** Test seam for deterministic companion evidence timestamps. */
  recordedAt?: string
  /** #2357 — external-model detection is performed at the CLI edge and injected here. */
  externalModelAccess?: ExternalModelAccess
}

export interface ShipResult {
  phase: TaskPhase
  step: ShipStep
  advanced: boolean
  done: boolean
  /** The effective tier after deterministic widening. Present on all real ship invocations. */
  tier?: ShipTier
  /** #1288 — the ship profile resolved from the target repo's arbiter.json. */
  profile: ShipProfile
}

/**
 * Build the human-readable step-output lines for a ship invocation, including the
 * #1260 tier + vertical-breadth summary. Kept here (not inline in the CLI action) so the
 * action stays simple and the formatting is unit-testable.
 */
function optionalShipStepLines(result: ShipResult): string[] {
  const lines: string[] = []
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
  return lines
}

export function buildShipStepLines(result: ShipResult, legacyTier?: string): string[] {
  const tier = result.tier ?? normTier(legacyTier)
  const lines = [
    `Phase: ${result.phase}${result.done ? ' (done)' : ''}`,
    `Action: ${result.step.action}`,
  ]
  lines.push(...optionalShipStepLines(result))
  lines.push(`Tier: ${tier} · verticals: ${result.step.verticals.join(', ')}`)
  // #1288 — the governance level the profile resolved from the target repo (RT-08: a real
  // consumer of the field, so the read is honest and not dead config).
  lines.push(`Governance: ${result.profile.governanceLevel}`)
  // #1291 — the resolved autonomy level travels with every step so the driver
  // (and a human reading the banner) sees which behaviors are authorized.
  lines.push(`Autonomy: ${result.profile.autonomy}`)
  if (result.phase === 'complete' && !autonomyAllows(result.profile.autonomy, 'auto-merge')) {
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
function trainLimitsFor(ship: ShipConfig | undefined, opts: TaskShipOptions): TrainLimits {
  return opts.trainLimits ?? resolveTrainLimits(ship)
}

function seedShipState(root: string, opts: TaskShipOptions, limits: TrainLimits): void {
  const taskId = opts.taskId !== undefined ? normalizeShipTaskId(opts.taskId) : undefined
  // #2102 — same numeric-only guard as the primary id (rejects non-numeric ids loudly).
  const chainIds = opts.chainIds !== undefined ? opts.chainIds.map(normalizeChainId) : undefined
  const existing = readUnifiedState(root)
  assertSeedWithinLimit(existing, taskId, chainIds, limits)
  if (
    existing === null ||
    taskId !== undefined ||
    opts.tier !== undefined ||
    opts.overrides !== undefined ||
    chainIds !== undefined
  ) {
    writeUnifiedState(root, {
      ...(taskId !== undefined ? { taskId } : {}),
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
      ...(opts.overrides !== undefined ? { overrides: opts.overrides } : {}),
      ...(chainIds !== undefined ? { chainIds } : {}),
    })
  }
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
): { phase: TaskPhase; advanced: boolean } {
  if (!opts.advance) return { phase, advanced: false }
  const target = advanceTargetFor(phase)
  if (target === null) return { phase, advanced: false }
  runTaskAdvance({ to: target, dir: root, ...(opts.advanceOpts ?? {}) })
  appendLog(root, `ship → advanced to ${target}`)
  return { phase: target, advanced: true }
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

function shipTierFor(
  root: string,
  state: ReturnType<typeof readUnifiedState>,
  opts: TaskShipOptions,
): ShipTier {
  // #2180 / Study C (#2176): text-only triage reached only 75.6% adjacent accuracy and 20%
  // fail-dangerous L→S errors. Routing therefore accepts deterministic signals only, and their
  // one-way floors can widen XS→S→Standard but can never narrow the caller's tier. Standard is
  // the widest tier, therefore a fixed point of this widen-only function: gathering its signals
  // cannot affect routing and is skipped to avoid an unnecessary graph parse and GitHub request.
  const base = normTier(opts.tier ?? state?.tier)
  return base === 'Standard'
    ? base
    : widenTier(
        base,
        (opts.gatherTierSignals ?? gatherTierSignals)(root, state?.taskId ?? opts.taskId),
      )
}

/**
 * Compute (and optionally advance to) the current ship step. Returns the step descriptor the agent
 * loop should execute next. With `advance`, advances one phase via runTaskAdvance — gate-green is
 * enforced by the underlying gates (a red gate throws and is surfaced to the caller).
 */
/**
 * #2331 — grow the open train by one or more ids, or refuse and tell the caller to land it.
 *
 * Runs BEFORE `seedShipState` so a refused append leaves the document exactly as it was: a
 * sealed train must not half-apply. Throws rather than returning a verdict because every caller
 * (CLI, orchestrator) must stop — `--chain-add` is a request that either takes effect or does
 * not.
 *
 * The tier for the appended issue is widened from `XS`, never from the train's current tier: the
 * question is whether THIS issue is risk-bearing, and seeding from a train that is already
 * Standard would seal every subsequent append for the wrong reason.
 */
function trainSignalsFor(
  root: string,
  opts: TaskShipOptions,
  state: UnifiedTaskState | null,
  now: Date,
  chainSize = (state?.taskId ? 1 : 0) + (state?.chainIds ?? []).length,
): TrainSignals {
  const gather = opts.gatherTierSignals ?? gatherTierSignals
  return {
    // The primary id rides the same branch, gate and PR, so it counts toward the bound.
    chainSize,
    openedAt: state?.timestamps.chainOpened,
    now,
    // Widen once per appended id; the strongest verdict across them decides.
    widenedTier: (opts.chainAddIds ?? []).reduce<ShipTier>(
      (acc, raw) => widenTier(acc, gather(root, normalizeChainId(raw))),
      'XS',
    ),
    explicitSeal: opts.seal === true,
  }
}

interface ChainAddContext {
  signalState: UnifiedTaskState | null
  currentSize: number
  projectedSize: number
}

function chainAddContext(opts: TaskShipOptions, state: UnifiedTaskState | null): ChainAddContext {
  const additions = opts.chainAddIds ?? []
  const taskId = opts.taskId !== undefined ? normalizeShipTaskId(opts.taskId) : state?.taskId
  const taskChanged = shipTaskChanged(state, taskId)
  const existing =
    opts.chainIds !== undefined
      ? opts.chainIds.map(normalizeChainId)
      : taskChanged
        ? []
        : (state?.chainIds ?? [])
  const primaryCount = hasShipTaskId(taskId) ? 1 : 0
  return {
    signalState: taskChanged ? null : state,
    currentSize: primaryCount + existing.length,
    projectedSize: primaryCount + appendChainIds(existing, additions).length,
  }
}

function assertChainAddAllowed(
  root: string,
  opts: TaskShipOptions,
  state: UnifiedTaskState | null,
  now: Date,
  limits: TrainLimits,
): void {
  const { signalState, currentSize, projectedSize } = chainAddContext(opts, state)
  const currentVerdict = evaluateSeal(
    trainSignalsFor(root, opts, signalState, now, currentSize),
    limits,
  )
  if (currentVerdict.sealed) {
    // UserFacingError, not Error: a seal is the policy working as designed, not a fault. The
    // generic handler would print "Unexpected error", telling the operator something broke.
    const seal = { reason: currentVerdict.reason, detail: currentVerdict.detail }
    throw new UserFacingError(t('errors.E_TRAIN_SEALED', seal))
  }
  if (projectedSize <= limits.maxChain) return
  const seal = {
    reason: 'max-chain' as const,
    detail: `the requested append would make the train carry ${projectedSize} issue(s), the limit is ${limits.maxChain}`,
  }
  throw new UserFacingError(t('errors.E_TRAIN_SEALED', seal))
}

function prepareChainAdd(
  root: string,
  opts: TaskShipOptions,
  limits: TrainLimits,
): { additions: readonly string[]; now: Date } | null {
  const additions = opts.chainAddIds ?? []
  if (additions.length === 0 && opts.seal !== true) return null

  const state = readUnifiedState(root)
  const now = opts.now ?? new Date()
  assertChainAddAllowed(root, opts, state, now, limits)
  return { additions, now }
}

/** Persist an accepted append. Split from the decision so each half stays legible. */
function persistTrainAppend(
  root: string,
  state: UnifiedTaskState | null,
  additions: readonly string[],
  now: Date,
): void {
  const existing = state?.chainIds ?? []
  const chainIds = appendChainIds(existing, additions)
  writeUnifiedState(root, {
    chainIds,
    // Stamp the open time on the first append only; `timestamps` is shallow-merged, so this
    // never disturbs the phase-transition stamps sharing the map.
    ...(state?.timestamps.chainOpened === undefined
      ? { timestamps: { chainOpened: now.toISOString() } }
      : {}),
  })
  appendLog(root, `ship → train +${chainIds.length - existing.length} (${chainIds.join(', ')})`)
}

function applyPreparedChainAdd(
  root: string,
  prepared: { additions: readonly string[]; now: Date } | null,
): void {
  if (prepared === null) return
  persistTrainAppend(root, readUnifiedState(root), prepared.additions, prepared.now)
}

/** #2400 — a review round that passed the cap check and is waiting to be persisted. */
interface ReviewRoundPlan {
  /** The round number this dispatch is, 1-based. */
  rounds: number
  maxRounds: number
  /** HEAD the PREVIOUS round was pinned to — the diff base for this one. Null on round 1. */
  base: string | null
  /** HEAD now; becomes the base for the next round. Null when git could not be read. */
  head: string | null
  forced: boolean
}

/**
 * HEAD, or null when it cannot be read (a fresh tree with no commit, or no git at all).
 *
 * FAIL-CLOSED on the cap: an unreadable sha costs the round its delta scope, never its count.
 * The opposite choice — skipping the round because HEAD is unknown — would silently disarm the
 * bound this feature exists to enforce.
 */
function headShaFor(root: string, opts: TaskShipOptions): string | null {
  if (opts.headSha !== undefined) return opts.headSha
  try {
    const sha = runCli('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim()
    return sha.length > 0 ? sha : null
    // FAIL-OPEN-INTENT: a missing HEAD costs the scope line, not the round (see above).
  } catch {
    return null
  }
}

/** The phase this invocation ends in — `--advance`'s target, or the phase it is already on. */
function resultingPhase(phase: TaskPhase, opts: TaskShipOptions): TaskPhase {
  if (opts.advance !== true) return phase
  return advanceTargetFor(phase) ?? phase
}

/**
 * #2400 — decide whether this invocation opens a review round, and refuse it once the cap is
 * spent.
 *
 * A round is opened by ENTERING `refactor` (the first review of the change) or by an explicit
 * `--review-round` while there (every re-dispatch after a fix). Both run through the same cap.
 * Throws rather than returning a verdict because the caller must stop: a refused round is the
 * signal to land the change with its remaining findings parked.
 */
function prepareReviewRound(
  root: string,
  phase: TaskPhase,
  opts: TaskShipOptions,
  ship: ShipConfig | undefined,
): ReviewRoundPlan | null {
  if (resultingPhase(phase, opts) !== REFACTOR_PHASE) return null
  if (opts.advance !== true && opts.reviewRound !== true) return null
  const previous = reviewStateOf(readUnifiedState(root))
  const maxRounds = opts.reviewMaxRounds ?? resolveReviewMaxRounds(ship)
  const forced = opts.forceReview === true
  const verdict = evaluateReviewRound({ rounds: previous.rounds, maxRounds, forced })
  if (!verdict.allowed) {
    // UserFacingError, not Error: a spent cap is the policy working as designed, not a fault.
    throw new UserFacingError(t('errors.E_REVIEW_ROUNDS_EXHAUSTED', { detail: verdict.detail }))
  }
  return {
    rounds: previous.rounds + 1,
    maxRounds,
    base: previous.lastReviewedSha,
    head: headShaFor(root, opts),
    forced,
  }
}

/** Persist an accepted round. Split from the decision so each half stays legible. */
function applyReviewRound(root: string, plan: ReviewRoundPlan | null): void {
  if (plan === null) return
  // `forced` is STICKY: it records that this task once needed a round past its cap, which stays
  // true however many ordinary rounds follow. `review` is replaced wholesale by the patch merge,
  // so carrying it forward here is what keeps the record from being erased by the next round.
  const wasForced = reviewStateOf(readUnifiedState(root)).forced === true
  writeUnifiedState(root, {
    review: {
      rounds: plan.rounds,
      lastReviewedSha: plan.head,
      ...(plan.forced || wasForced ? { forced: true } : {}),
    },
  })
  const at = plan.head === null ? 'an unknown sha' : plan.head.slice(0, 7)
  appendLog(root, `review → round ${plan.rounds} at ${at}${plan.forced ? ' (forced)' : ''}`)
}

export function runTaskShip(opts: TaskShipOptions = {}): ShipResult {
  const root = opts.dir ?? process.cwd()
  const shipConfig = shipConfigFor(root)
  // Validate the complete train mutation before seeding task metadata. A rejected append must
  // leave both fresh and existing state untouched, including task/tier/override fields.
  const trainLimits = trainLimitsFor(shipConfig, opts)
  const preparedChainAdd = prepareChainAdd(root, opts, trainLimits)
  seedShipState(root, opts, trainLimits)
  applyPreparedChainAdd(root, preparedChainAdd)

  const state = readUnifiedState(root)
  let phase: TaskPhase = state?.phase ?? 'preflight'
  const tier = shipTierFor(root, state, opts)
  // #2400 — decide the round BEFORE the phase advances, so a refused round leaves the document
  // exactly as it was (same contract as a sealed train).
  const preparedRound = prepareReviewRound(root, phase, opts, shipConfig)

  // #1288 — resolve the profile from the TARGET repo's arbiter.json so steps are config-aware
  // and self-only authoring gates are skipped in a consumer repo.
  const profile = shipProfileFor(root, opts)
  const advancedPhase = advanceShipPhase(root, phase, opts)
  phase = advancedPhase.phase
  applyReviewRound(root, preparedRound)
  writeVerificationCompanionEvidence(root, phase, state?.taskId, profile, opts)

  return {
    phase,
    // #2102 — thread taskId + chainIds through so the close-step text names the whole chain.
    step: shipStepFor(phase, tier, profile, state?.taskId, {
      chainIds: state?.chainIds ?? [],
      ...(opts.externalModelAccess !== undefined
        ? { externalModelAccess: opts.externalModelAccess }
        : {}),
      // #2400 — the delta scope belongs to the round just recorded, not to the phase: a bare
      // `arbiter ship` re-reading the step must not re-announce a review it did not dispatch.
      ...(preparedRound !== null ? { review: preparedRound } : {}),
    }),
    advanced: advancedPhase.advanced,
    done: phase === 'complete',
    tier,
    profile,
  }
}
