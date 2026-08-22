// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/commands/task-ship.ts (#1486).
 *
 * Targets the if/else, flag-combo, early-return and error branches the
 * established ship suites do not reach:
 *   - normalizeShipTaskId: valid `#NNN` vs invalid-throw
 *   - normTier via shipStepFor: 'XS' / 'S' / default 'Standard'
 *   - plan action: the constant single-issue string (#2329)
 *   - completeAction: non-trunk-solo / trunk-solo+direct / trunk-solo+pr-ff
 *   - verificationSelfOnlyChecks: isArbiterSelf true vs false
 *   - shipStepBody: every phase case, incl. the lateral red-team-rework
 *   - nextPhase: idx===-1 (lateral) / end / normal
 *   - advanceTargetFor (via runTaskShip advance): lateral re-entry vs forward
 *   - buildShipStepLines: done / command / reviewAgents / autonomy-gate /
 *     self-only-checks present vs absent
 *   - seedShipState + runTaskShip: id/tier defaulting, fresh vs existing state,
 *     advance true(target!==null) / advance true(end → target===null) / no advance
 *
 * Pure test-only: the fs-backed state I/O runs against a real mkdtempSync temp
 * dir (cleaned per test); every advance target is steered to a gate-free phase
 * so runTaskAdvance never invokes a real gate, git, gh, or the `claude` CLI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  shipStepFor,
  nextPhase,
  buildShipStepLines,
  runTaskShip,
  type ShipResult,
} from '../../src/commands/task-ship.js'
import {
  CONSUMER_DEFAULT_PROFILE,
  type ShipProfile,
} from '../../src/commands/ship-profile.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-ship-cov-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Build a full ShipProfile from the consumer default with explicit overrides. */
function profile(overrides: Partial<ShipProfile> = {}): ShipProfile {
  return { ...CONSUMER_DEFAULT_PROFILE, ...overrides }
}

describe('shipStepFor — normTier + per-phase bodies', () => {
  it('normTier returns XS / S verbatim and defaults everything else to Standard', () => {
    expect(shipStepFor('red-team-review', 'XS').reviewAgents).toBe(1)
    expect(shipStepFor('red-team-review', 'S').reviewAgents).toBe(2)
    expect(shipStepFor('red-team-review', 'Standard').reviewAgents).toBe(3)
    // unknown tier + undefined both fall through to Standard
    expect(shipStepFor('red-team-review', 'bogus').reviewAgents).toBe(3)
    expect(shipStepFor('red-team-review', undefined).reviewAgents).toBe(3)
  })

  it('refactor review-agent count tracks the tier table', () => {
    expect(shipStepFor('refactor', 'XS').reviewAgents).toBe(1)
    expect(shipStepFor('refactor', 'Standard').reviewAgents).toBe(2)
  })

  it('covers every phase body case, including the lateral red-team-rework', () => {
    const phases = [
      'preflight',
      'plan',
      'red-team-review',
      'red-team-rework',
      'red',
      'green',
      'refactor',
      'verification',
      'complete',
    ] as const
    for (const p of phases) {
      const step = shipStepFor(p, 'Standard')
      expect(step.phase).toBe(p)
      expect(Array.isArray(step.verticals)).toBe(true)
    }
  })

  it('preflight + red carry a command; green carries none', () => {
    expect(shipStepFor('preflight', 'S').command).toContain('arbiter task init')
    expect(shipStepFor('red', 'S').command).toContain('record-red')
    expect(shipStepFor('green', 'S').command).toBeUndefined()
  })
})

// #2329 — the plan action is a constant: the affinityBatching knob that used to
// branch it was deleted along with the affinity engine (#1817 B-prune).
describe('plan action — single-issue, knob-free', () => {
  it('is the same string regardless of the worktree cap', () => {
    for (const maxParallelWorktrees of [1, 4, 8]) {
      const step = shipStepFor('plan', 'Standard', profile({ maxParallelWorktrees }))
      expect(step.action).toBe('Write the plan, then pass the plan-review gate.')
    }
  })
})

describe('completeAction branch — collaboration × merge mode', () => {
  it('non-trunk-solo always requires a PR + review', () => {
    const step = shipStepFor('complete', 'S', profile({ collaborationMode: 'peer-review' }))
    expect(step.action).toContain('open a PR')
    expect(step.action).toContain('await required review')
  })

  it('trunk-solo + direct pushes through the gate with no PR', () => {
    const step = shipStepFor(
      'complete',
      'S',
      profile({ collaborationMode: 'trunk-solo', mergeMode: 'direct' }),
    )
    expect(step.action).toContain('no PR')
  })

  it('trunk-solo + pr-ff opens a PR and fast-forward merges', () => {
    const step = shipStepFor(
      'complete',
      'S',
      profile({ collaborationMode: 'trunk-solo', mergeMode: 'pr-ff' }),
    )
    expect(step.action).toContain('fast-forward merge')
  })
})

describe('verificationSelfOnlyChecks branch', () => {
  it('arbiter-self carries the self-only authoring gates on verification', () => {
    const step = shipStepFor('verification', 'Standard', profile({ isArbiterSelf: true }))
    expect(step.selfOnlyChecks).toEqual([
      'template-authoring',
      'selfOnly-invariants',
      'matrix-fixtures',
    ])
  })

  it('a consumer repo carries an empty self-only list', () => {
    const step = shipStepFor('verification', 'Standard', profile({ isArbiterSelf: false }))
    expect(step.selfOnlyChecks).toEqual([])
  })
})

describe('nextPhase branch', () => {
  it('returns the forward phase for a mid-sequence phase', () => {
    expect(nextPhase('preflight')).toBe('plan')
    expect(nextPhase('verification')).toBe('close')
    expect(nextPhase('close')).toBe('complete')
  })

  it('returns null at the terminal phase', () => {
    expect(nextPhase('complete')).toBeNull()
  })

  it('returns null for a lateral phase not in PHASE_ORDER (idx === -1)', () => {
    expect(nextPhase('red-team-rework')).toBeNull()
  })
})

describe('buildShipStepLines branch matrix', () => {
  function resultFor(phase: ShipResult['phase'], prof: ShipProfile, done: boolean): ShipResult {
    return { phase, step: shipStepFor(phase, 'Standard', prof), advanced: false, done, profile: prof }
  }

  it('marks (done), prints Command + Review agents, and omits the self-only header for a consumer', () => {
    const lines = buildShipStepLines(resultFor('red-team-review', profile(), false), 'Standard')
    expect(lines.some((l) => l.startsWith('Phase: red-team-review'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Command:'))).toBe(false) // red-team-review has none
    expect(lines.some((l) => l.startsWith('Review agents: 3'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Self-only checks:'))).toBe(false)
  })

  it('prints the Command line when a phase carries a command', () => {
    const lines = buildShipStepLines(resultFor('preflight', profile(), false), 'Standard')
    expect(lines.some((l) => l.startsWith('Command: arbiter task init'))).toBe(true)
  })

  it('appends " (done)" and prints the self-only header for an arbiter-self verification', () => {
    const prof = profile({ isArbiterSelf: true })
    const lines = buildShipStepLines(resultFor('verification', prof, true), 'Standard')
    expect(lines[0]).toBe('Phase: verification (done)')
    expect(lines.some((l) => l.startsWith('Self-only checks: template-authoring'))).toBe(true)
  })

  it('omits the Review-agents line for a zero-review phase (green)', () => {
    const lines = buildShipStepLines(resultFor('green', profile(), false), 'Standard')
    expect(lines.some((l) => l.startsWith('Review agents:'))).toBe(false)
  })

  it('emits the autonomy STOP gate on complete when autonomy denies auto-merge (L0)', () => {
    const lines = buildShipStepLines(resultFor('complete', profile({ autonomy: 'L0' }), false), 'Standard')
    expect(lines.some((l) => l.includes('Autonomy gate: STOP'))).toBe(true)
  })

  it('omits the autonomy STOP gate on complete when autonomy permits auto-merge (L1)', () => {
    const lines = buildShipStepLines(resultFor('complete', profile({ autonomy: 'L1' }), false), 'Standard')
    expect(lines.some((l) => l.includes('Autonomy gate: STOP'))).toBe(false)
  })

  it('never shows the autonomy STOP gate off the complete phase, even at L0', () => {
    const lines = buildShipStepLines(resultFor('plan', profile({ autonomy: 'L0' }), false), 'Standard')
    expect(lines.some((l) => l.includes('Autonomy gate: STOP'))).toBe(false)
  })

  it('always emits Governance + Autonomy lines', () => {
    const lines = buildShipStepLines(resultFor('plan', profile(), false), 'Standard')
    expect(lines.some((l) => l.startsWith('Governance: '))).toBe(true)
    expect(lines.some((l) => l.startsWith('Autonomy: '))).toBe(true)
  })
})

describe('runTaskShip — seedShipState + drive branches (real temp-dir state I/O)', () => {
  it('seeds fresh state from a bare numeric id (normalized to #NNN) and defaults to preflight', () => {
    const res = runTaskShip({ dir, taskId: '1280', tier: 'S' })
    expect(res.phase).toBe('preflight')
    expect(res.advanced).toBe(false)
    expect(res.done).toBe(false)
    // tier flows through to the step's review-agent count (S red-team => 2)
    expect(shipStepFor('red-team-review', 'S').reviewAgents).toBe(2)
  })

  it('normalizes a `#`-prefixed id and an existing fresh tree still writes when id is given', () => {
    const res = runTaskShip({ dir, taskId: '#42' })
    expect(res.profile).toBeDefined()
    expect(res.phase).toBe('preflight')
  })

  it('throws on a non-numeric ship id (normalizeShipTaskId guard)', () => {
    expect(() => runTaskShip({ dir, taskId: 'feature-x' })).toThrow(/Invalid ship task id/)
  })

  it('leaves an existing non-null state untouched when no id/tier is supplied', () => {
    writeUnifiedState(dir, { taskId: '#7', tier: 'XS', phase: 'plan' })
    const res = runTaskShip({ dir })
    expect(res.phase).toBe('plan')
    // tier comes from persisted state (XS) since opts.tier is undefined
    expect(res.step.phase).toBe('plan')
  })

  it('prefers opts.tier over the persisted tier', () => {
    writeUnifiedState(dir, { taskId: '#7', tier: 'XS', phase: 'red-team-review' })
    const res = runTaskShip({ dir, tier: 'Standard' })
    // Standard red-team => 3 agents (vs XS => 1)
    expect(res.step.reviewAgents).toBe(3)
  })

  it('advances one gate-free phase (preflight → plan) and logs the transition', () => {
    runTaskShip({ dir, taskId: '#7', tier: 'S' })
    const res = runTaskShip({ dir, advance: true })
    expect(res.advanced).toBe(true)
    expect(res.phase).toBe('plan')
  })

  it('advances via the lateral re-entry (red-team-rework → red-team-review)', () => {
    writeUnifiedState(dir, { taskId: '#7', tier: 'S', phase: 'red-team-rework' })
    const res = runTaskShip({ dir, advance: true })
    expect(res.advanced).toBe(true)
    expect(res.phase).toBe('red-team-review')
  })

  it('does NOT advance from the terminal phase (advanceTargetFor → null)', () => {
    writeUnifiedState(dir, { taskId: '#7', tier: 'S', phase: 'complete' })
    const res = runTaskShip({ dir, advance: true })
    expect(res.advanced).toBe(false)
    expect(res.phase).toBe('complete')
    expect(res.done).toBe(true)
  })

  it('threads autonomy + overrides through resolveShipProfile without throwing', () => {
    const res = runTaskShip({ dir, taskId: '#9', tier: 'S', autonomy: 'L1', overrides: {} })
    expect(res.profile.autonomy).toBe('L1')
  })

  it('detects arbiter-self via the target package.json name', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@arbiter/cli' }))
    const res = runTaskShip({ dir, taskId: '#11', tier: 'Standard' })
    expect(res.profile.isArbiterSelf).toBe(true)
  })

  it('treats a non-arbiter package.json as a consumer repo', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'some-consumer' }))
    const res = runTaskShip({ dir, taskId: '#12', tier: 'Standard' })
    expect(res.profile.isArbiterSelf).toBe(false)
  })

  it('forwards advanceOpts to the advance call (skipPlanReview on a gate-free hop)', () => {
    runTaskShip({ dir, taskId: '#7', tier: 'S' })
    const res = runTaskShip({ dir, advance: true, advanceOpts: { skipPlanReview: true } })
    expect(res.phase).toBe('plan')
  })
})
