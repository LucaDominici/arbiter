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
import {
  type TaskPhase,
  PHASE_ORDER,
  readUnifiedState,
  writeUnifiedState,
  appendLog,
} from './task-state.js'
import { runTaskAdvance } from './task.js'

export type ShipTier = 'XS' | 'S' | 'Standard'

/** Pre-implementation red-team agents per tier (mirrors /task Phase 3.5). */
const REDTEAM_AGENTS: Record<ShipTier, number> = { XS: 1, S: 2, Standard: 3 }
/** Post-implementation code-review agents per tier (mirrors /task Phase 6 minimums). */
const REVIEW_AGENTS: Record<ShipTier, number> = { XS: 3, S: 3, Standard: 4 }

function normTier(tier: string | undefined): ShipTier {
  if (tier === 'XS' || tier === 'S') return tier
  return 'Standard'
}

export interface ShipStep {
  phase: TaskPhase
  /** What the agent must do while in this phase. */
  action: string
  /** Arbiter command that completes / gates this phase, if any. */
  command?: string
  /** Number of review subagents the agent must dispatch in this phase (0 = none). */
  reviewAgents: number
}

/** The concrete step for a given phase + tier. */
export function shipStepFor(phase: TaskPhase, tier: string | undefined): ShipStep {
  const t = normTier(tier)
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
        action: 'Write the plan, then pass the plan-review gate.',
        command: 'arbiter review plan <plan-file>',
        reviewAgents: 0,
      }
    case 'red-team-review':
      return {
        phase,
        action: `Dispatch ${REDTEAM_AGENTS[t]} red-team agent(s); route CRITICAL findings to red-team-rework.`,
        reviewAgents: REDTEAM_AGENTS[t],
      }
    case 'red-team-rework':
      return {
        phase,
        action: 'Revise the plan for CRITICAL findings, then re-run red-team-review.',
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
        action: 'Implement the minimum to make the tests pass.',
        reviewAgents: 0,
      }
    case 'refactor':
      return {
        phase,
        action: `Clean up, then dispatch ${REVIEW_AGENTS[t]} code-review agent(s) + 1 adversarial verifier.`,
        reviewAgents: REVIEW_AGENTS[t],
      }
    case 'verification':
      return {
        phase,
        action: 'Run the gate; fix any failures.',
        command: 'node scripts/check-all.mjs check',
        reviewAgents: 0,
      }
    case 'complete':
      return {
        phase,
        action: 'Commit, push, open/merge the PR, close the issue, clean up the worktree.',
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

/** The full ordered ship plan for a tier. */
export function shipSequence(tier: string | undefined): ShipStep[] {
  return PHASE_ORDER.map((p) => shipStepFor(p, tier))
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
  /** Advance to the next phase first (runs that phase's gate; throws if the gate is red). */
  advance?: boolean
  /** Bubble handoff/budget control-flow to the caller instead of being swallowed. */
  advanceOpts?: {
    skipPlanReview?: boolean
    postClear?: boolean
    skipBudget?: boolean
    units?: number
  }
}

export interface ShipResult {
  phase: TaskPhase
  step: ShipStep
  advanced: boolean
  done: boolean
}

/**
 * Compute (and optionally advance to) the current ship step. Returns the step descriptor the agent
 * loop should execute next. With `advance`, advances one phase via runTaskAdvance — gate-green is
 * enforced by the underlying gates (a red gate throws and is surfaced to the caller).
 */
export function runTaskShip(opts: TaskShipOptions = {}): ShipResult {
  const root = opts.dir ?? process.cwd()

  // Seed state on first invocation so the orchestrator has an id/tier to work from.
  const existing = readUnifiedState(root)
  if (existing === null || opts.taskId !== undefined || opts.tier !== undefined) {
    writeUnifiedState(root, {
      ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
    })
  }

  const state = readUnifiedState(root)
  let phase: TaskPhase = state?.phase ?? 'preflight'
  const tier = opts.tier ?? state?.tier

  let advanced = false
  if (opts.advance) {
    const target = advanceTargetFor(phase)
    if (target !== null) {
      runTaskAdvance({ to: target, dir: root, ...(opts.advanceOpts ?? {}) })
      phase = target
      advanced = true
      appendLog(root, `ship → advanced to ${target}`)
    }
  }

  return {
    phase,
    step: shipStepFor(phase, tier),
    advanced,
    done: phase === 'complete',
  }
}
