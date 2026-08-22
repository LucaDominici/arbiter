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
import { join } from 'node:path'
import { z } from 'zod'
import {
  type TaskPhase,
  PHASE_ORDER,
  readUnifiedState,
  writeUnifiedState,
  appendLog,
  normalizeChainId,
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
import {
  gatherTierSignals,
  normTier,
  widenTier,
  type ShipTier,
  type TierSignals,
} from './ship-tier.js'

export { type ShipTier } from './ship-tier.js'
import {
  DEFAULT_TRAIN_LIMITS,
  appendChainIds,
  evaluateSeal,
  type TrainLimits,
} from './ship-train.js'

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
  /** #2102 — declared merge-train batch (`--chain`); empty ⇒ text is unchanged (single issue). */
  chainIds: readonly string[] = [],
): ShipStep {
  const t = normTier(tier)
  const verticals = verticalsForTier(t)
  const withVerticals = (step: Omit<ShipStep, 'verticals'>): ShipStep => ({ ...step, verticals })
  return withVerticals(shipStepBody(phase, t, profile, taskId, chainIds))
}

/**
 * The (collaborationMode × mergeMode) merge next-action (#1288 RT-02). A review mode
 * (peer-review / gated-review) ALWAYS requires a PR + human review — even if the user
 * persisted `solo.mergeMode:'direct'`, which would otherwise silently bypass the very review
 * the mode mandates. Only trunk-solo keys on mergeMode. Strings are strictly advisory and route
 * through the project gate — the engine never performs the merge itself.
 */
/**
 * #1306 — the plan next-action, shaped by the wave-orchestration prefs. When
 * affinityBatching is on AND the profile permits >1 concurrent worktree, the plan
 * step advises grouping affinity-related issues into a parallel wave (bounded by
 * maxParallelWorktrees); otherwise it stays a single-issue plan. The engine never
 * spawns worktrees itself — the string is advisory and routes through the wave loop.
 */
function planAction(profile: ShipProfile): string {
  if (profile.affinityBatching && profile.maxParallelWorktrees > 1) {
    return (
      `Write the plan, then pass the plan-review gate. Affinity batching is on: ` +
      `group affinity-related issues into a wave of up to ${profile.maxParallelWorktrees} ` +
      `parallel worktrees.`
    )
  }
  return 'Write the plan, then pass the plan-review gate.'
}

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
    'else declare BLOCKED. Foreground-wait on the PR/gate checks; never end the turn on a promise.'
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

function reviewPhaseStepBody(phase: ReviewPhase, t: ShipTier): Omit<ShipStep, 'verticals'> {
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
  return {
    phase,
    action: `Clean up, then dispatch ${REVIEW_AGENTS[t]} code-review agent(s) + 1 adversarial verifier.`,
    reviewAgents: REVIEW_AGENTS[t],
  }
}

/** The phase body (count + action), before the size-derived vertical floor is attached. */
function shipStepBody(
  phase: TaskPhase,
  t: ShipTier,
  profile: ShipProfile,
  taskId?: string,
  chainIds: readonly string[] = [],
): Omit<ShipStep, 'verticals'> {
  if (isReviewPhase(phase)) return reviewPhaseStepBody(phase, t)

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
        // #1306 — the plan step consumes profile.affinityBatching + maxParallelWorktrees
        // (resolved through the unified resolver): they tell the wave orchestrator whether
        // to group affinity-related issues and how many worktrees may run concurrently.
        action: planAction(profile),
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
        action: completeAction(profile, taskId, chainIds),
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
  /** Test seam: deterministic train bounds and clock without touching config or wall time. */
  trainLimits?: TrainLimits
  /** Test seam for a deterministic train clock. */
  now?: Date
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
  }
  /** Test seam for evidence emission without depending on local HOME/plugin state. */
  profileOverride?: ShipProfile
  /** Test seam for deterministic companion evidence diff stats. */
  gatherCompanionDiffStats?: (repoDir: string) => CompanionDiffStats
  /** Test seam for deterministic tier-routing signals without graphify or GitHub CLI state. */
  gatherTierSignals?: (root: string, taskId: string | undefined) => TierSignals
  /** Test seam for deterministic companion evidence timestamps. */
  recordedAt?: string
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
export function buildShipStepLines(result: ShipResult, legacyTier?: string): string[] {
  const tier = result.tier ?? normTier(legacyTier)
  const lines = [
    `Phase: ${result.phase}${result.done ? ' (done)' : ''}`,
    `Action: ${result.step.action}`,
  ]
  if (result.step.command) lines.push(`Command: ${result.step.command}`)
  if (result.step.reviewAgents > 0) lines.push(`Review agents: ${result.step.reviewAgents}`)
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
function seedShipState(
  root: string,
  rawTaskId: string | undefined,
  tier: string | undefined,
  overrides: Record<string, string> | undefined,
  rawChainIds: string[] | undefined,
): void {
  const taskId = rawTaskId !== undefined ? normalizeShipTaskId(rawTaskId) : undefined
  // #2102 — same numeric-only guard as the primary id (rejects non-numeric ids loudly).
  const chainIds = rawChainIds !== undefined ? rawChainIds.map(normalizeChainId) : undefined
  const existing = readUnifiedState(root)
  if (
    existing === null ||
    taskId !== undefined ||
    tier !== undefined ||
    overrides !== undefined ||
    chainIds !== undefined
  ) {
    writeUnifiedState(root, {
      ...(taskId !== undefined ? { taskId } : {}),
      ...(tier !== undefined ? { tier } : {}),
      ...(overrides !== undefined ? { overrides } : {}),
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
function applyChainAdd(root: string, opts: TaskShipOptions): void {
  const additions = opts.chainAddIds ?? []
  if (additions.length === 0 && opts.seal !== true) return

  const state = readUnifiedState(root)
  const existing = state?.chainIds ?? []
  const limits = opts.trainLimits ?? DEFAULT_TRAIN_LIMITS
  const now = opts.now ?? new Date()
  const gather = opts.gatherTierSignals ?? gatherTierSignals

  // The primary id rides the same branch, gate and PR, so it counts toward the bound.
  const chainSize = (state?.taskId ? 1 : 0) + existing.length
  // Widen once per appended id; the strongest verdict across them decides.
  const widenedTier = additions.reduce<ShipTier>(
    (acc, raw) => widenTier(acc, gather(root, normalizeChainId(raw))),
    'XS',
  )

  const verdict = evaluateSeal(
    {
      chainSize,
      openedAt: state?.timestamps?.chainOpened,
      now,
      widenedTier,
      explicitSeal: opts.seal === true,
    },
    limits,
  )
  if (verdict.sealed) {
    throw new Error(
      `SEALED: ${verdict.reason} — ${verdict.detail}. ` +
        `Land this train (gate, push, one PR closing every id) before starting the next one.`,
    )
  }

  const chainIds = appendChainIds(existing, additions)
  writeUnifiedState(root, {
    chainIds,
    // Stamp the open time on the first append only; `timestamps` is shallow-merged, so this
    // never disturbs the phase-transition stamps sharing the map.
    ...(state?.timestamps?.chainOpened === undefined
      ? { timestamps: { chainOpened: now.toISOString() } }
      : {}),
  })
  appendLog(root, `ship → train +${chainIds.length - existing.length} (${chainIds.join(', ')})`)
}

export function runTaskShip(opts: TaskShipOptions = {}): ShipResult {
  const root = opts.dir ?? process.cwd()
  seedShipState(root, opts.taskId, opts.tier, opts.overrides, opts.chainIds)
  applyChainAdd(root, opts)

  const state = readUnifiedState(root)
  let phase: TaskPhase = state?.phase ?? 'preflight'
  const tier = shipTierFor(root, state, opts)

  // #1288 — resolve the profile from the TARGET repo's arbiter.json so steps are config-aware
  // and self-only authoring gates are skipped in a consumer repo.
  const profile = shipProfileFor(root, opts)
  const advancedPhase = advanceShipPhase(root, phase, opts)
  phase = advancedPhase.phase
  writeVerificationCompanionEvidence(root, phase, state?.taskId, profile, opts)

  return {
    phase,
    // #2102 — thread taskId + chainIds through so the close-step text names the whole chain.
    step: shipStepFor(phase, tier, profile, state?.taskId, state?.chainIds ?? []),
    advanced: advancedPhase.advanced,
    done: phase === 'complete',
    tier,
    profile,
  }
}
