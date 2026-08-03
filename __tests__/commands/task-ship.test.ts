// SPDX-License-Identifier: Apache-2.0
//
// `/ship` orchestrator sequencing (#1206): step computation + auto-advance over the existing engine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import {
  runTaskShip,
  shipStepFor,
  nextPhase,
  buildShipStepLines,
  REVIEW_AGENTS_SECURITY_SURFACE,
  type ShipResult,
} from '../../src/commands/task-ship.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'
import type { ShipProfile } from '../../src/commands/ship-profile.js'
import { widenTier } from '../../src/commands/ship-tier.js'
import { SKILLS_MATRIX } from '../../src/integrations/skills-matrix.js'

// Gates that would otherwise require a real repo / model switch
vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({ modelSwitch: false, transcriptPath: null }),
}))
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
  currentBranch: vi.fn().mockReturnValue('task/1206-gate-marker'),
  headSha: vi.fn().mockReturnValue('b'.repeat(40)),
}))

function writeTddEvidence(dir: string, taskId: string): void {
  const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(
    join(evDir, `${taskId}.json`),
    JSON.stringify({
      $schemaVersion: 1,
      task_id: taskId,
      test_path: '__tests__/x.test.ts',
      test_commit_sha: 'a'.repeat(40),
      test_run_log: 'FAIL __tests__/x.test.ts\n✗ 1 test failed',
      observed_failure: 'FAIL __tests__/x.test.ts',
      recorded_at: '2026-06-04T00:00:00.000Z',
    }),
    'utf-8',
  )
}

function writeGatePassMarker(dir: string, taskId: string): void {
  const markerDir = join(dir, '.arbiter')
  mkdirSync(markerDir, { recursive: true })
  writeFileSync(
    join(markerDir, 'gate-pass.json'),
    JSON.stringify({
      head_sha: 'b'.repeat(40),
      branch: 'task/1206-gate-marker',
      task_id: taskId,
      timestamp: '2026-08-03T00:00:00.000Z',
      level: 'L2',
      node_version: process.version,
      git_user: 'test-user',
      tree_was_clean_at_run_time: true,
    }),
    'utf-8',
  )
}

function companionEvidencePath(taskId: string, dir: string): string {
  return join(dir, '.arbiter', 'evidence', 'companions', `${taskId}.json`)
}

describe('ship sequencing — pure plan', () => {
  it('dispatches tier-N red-team agents at red-team-review', () => {
    expect(shipStepFor('red-team-review', 'XS').reviewAgents).toBe(1)
    expect(shipStepFor('red-team-review', 'S').reviewAgents).toBe(2)
    expect(shipStepFor('red-team-review', 'Standard').reviewAgents).toBe(3)
  })

  it('dispatches tier-N code-review agents at refactor', () => {
    expect(shipStepFor('refactor', 'XS').reviewAgents).toBe(1)
    expect(shipStepFor('refactor', 'S').reviewAgents).toBe(1)
    expect(shipStepFor('refactor', 'Standard').reviewAgents).toBe(2)
  })

  it('derives code-review count from the final, post-widening tier (AC-3)', () => {
    expect(
      shipStepFor(
        'refactor',
        widenTier('XS', { blastRadius: 75, labels: [], milestoneBundled: false }),
      ).reviewAgents,
    ).toBe(2)
    expect(
      shipStepFor(
        'refactor',
        widenTier('XS', { blastRadius: 25, labels: [], milestoneBundled: false }),
      ).reviewAgents,
    ).toBe(1)
  })

  // #1260 — size (via tier) drives BOTH the review-agent COUNT and the orthogonal
  // VERTICAL breadth. This is the "drive, not print" proof: both fields move together.
  it('refactor step surfaces a vertical floor that WIDENS with tier (count + breadth)', () => {
    const xs = shipStepFor('refactor', 'XS')
    const s = shipStepFor('refactor', 'S')
    const std = shipStepFor('refactor', 'Standard')

    // breadth widens with size
    expect(s.verticals.length).toBeGreaterThan(xs.verticals.length)
    expect(std.verticals.length).toBeGreaterThan(s.verticals.length)
    expect(s.verticals).toEqual(expect.arrayContaining(xs.verticals))
    expect(std.verticals).toEqual(expect.arrayContaining(s.verticals))

    // count widens too (Standard refactor > XS refactor)
    expect(std.reviewAgents).toBeGreaterThan(xs.reviewAgents)

    // verticals are real auditor-routing names (not free text)
    expect(std.verticals).toContain('security')
    expect(std.verticals).toContain('data-integrity')
  })

  it('red-team-review step also carries the size-derived vertical floor', () => {
    expect(shipStepFor('red-team-review', 'Standard').verticals).toContain('security')
    expect(shipStepFor('red-team-review', 'XS').verticals).toEqual([
      'bugs',
      'type-safety',
      'domain',
    ])
  })

  it('nextPhase walks forward and stops at complete', () => {
    expect(nextPhase('plan')).toBe('red-team-review')
    expect(nextPhase('red-team-review')).toBe('red')
    expect(nextPhase('complete')).toBeNull()
  })
})

describe('self /ship documentation coherence (#2178)', () => {
  const shipCommand = readFileSync(join(process.cwd(), '.claude', 'commands', 'ship.md'), 'utf-8')

  it('states the recalibrated code-review minimums by tier', () => {
    expect(
      shipCommand.includes('XS=1, S=1, Standard=2') &&
        shipCommand.includes(
          `Security escalation — ${REVIEW_AGENTS_SECURITY_SURFACE} code-review agents.`,
        ),
    ).toBe(true)
  })

  it('reserves three code-review agents for the file-path-matched auditor set', () => {
    expect(shipCommand.includes('3 code-review agents')).toBe(true)
    expect(shipCommand.includes('file-path-matched auditor set')).toBe(true)
    expect(shipCommand.includes('route-auditors.mjs')).toBe(true)
  })

  it('names review completion as the precondition that makes a single reviewer safe', () => {
    expect(shipCommand.includes('scripts/check-review-completion.mjs')).toBe(true)
    expect(shipCommand.includes('single reviewer safe')).toBe(true)
  })
})

// #1280 — the bare positional id (`ship 1280 ...`) must be normalized to the canonical
// `#NNN` form ONCE at parse: the TDD-evidence schema requires `^#\d+$` and the gate's
// identity check compares against the persisted taskId, so an un-sanitized bare id makes
// the gate unsatisfiable via `ship --advance`.
describe('ship id normalization (#1280)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('normalizes a bare positional id to #NNN at parse', () => {
    runTaskShip({ dir, taskId: '1280', tier: 'XS' })
    expect(readUnifiedState(dir)?.taskId).toBe('#1280')
  })

  it('keeps an already-canonical #NNN id unchanged', () => {
    runTaskShip({ dir, taskId: '#1280', tier: 'XS' })
    expect(readUnifiedState(dir)?.taskId).toBe('#1280')
  })

  it('persists override-only resume state across the next ship invocation', () => {
    runTaskShip({ dir, taskId: '#1280', tier: 'XS' })
    runTaskShip({ dir, overrides: { 'automation.autonomy': 'L3' } })
    expect(readUnifiedState(dir)?.overrides).toEqual({ 'automation.autonomy': 'L3' })
  })

  it('rejects a non-numeric id loudly instead of silently coercing', () => {
    expect(() => runTaskShip({ dir, taskId: 'abc' })).toThrow(/[Ii]nvalid.*task id/)
  })

  it('TDD-evidence gate is satisfiable end-to-end when seeded with a bare id', () => {
    // Seed with the BARE id — exactly what `ship 1280 ...` passes through the CLI.
    runTaskShip({ dir, taskId: '1280', tier: 'XS' })
    // Evidence on disk uses the canonical schema form (`^#\d+$`), as the schema requires.
    writeTddEvidence(dir, '#1280')
    writeUnifiedState(dir, { phase: 'red' })
    // red → green runs checkTddEvidenceGate: path lookup + identity check both need '#1280'.
    const r = runTaskShip({ dir, advance: true })
    expect(r.phase).toBe('green')
    expect(r.advanced).toBe(true)
  })

  it('AC-7 a new ship id cannot inherit a prior task complete phase or plan', () => {
    writeUnifiedState(dir, {
      taskId: '#2120',
      phase: 'complete',
      tier: 'Standard',
      plan: '.claude/plans/old.md',
      branch: 'tmp-red',
    })
    const result = runTaskShip({ dir, taskId: '2135', tier: 'S' })
    expect(result.phase).toBe('preflight')
    expect(result.done).toBe(false)
    expect(readUnifiedState(dir)).toMatchObject({
      taskId: '#2135',
      phase: 'preflight',
      tier: 'S',
      plan: '',
    })
  })
})

describe('ship orchestrator — drives a fixture end-to-end', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('seeds id/tier on first invocation and reports the preflight step', () => {
    const r = runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    expect(r.phase).toBe('preflight')
    expect(r.done).toBe(false)
    expect(readUnifiedState(dir)?.taskId).toBe('#1206')
    expect(readUnifiedState(dir)?.tier).toBe('Standard')
  })

  it('--advance from red-team-rework re-enters red-team-review (no silent stall)', () => {
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeUnifiedState(dir, { phase: 'red-team-rework' })
    const r = runTaskShip({ dir, advance: true })
    expect(r.advanced).toBe(true)
    expect(r.phase).toBe('red-team-review')
  })

  it('auto-advances phase-by-phase through gate-green to complete', () => {
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeTddEvidence(dir, '#1206')
    // The verification/close/complete phase gates require a real-shape marker correlated to
    // this fixture's mocked branch and HEAD, just as a successful check-all run would write.
    writeGatePassMarker(dir, '#1206')

    const visited: TaskPhase[] = ['preflight']
    let guard = 0
    let done = false
    while (!done && guard < 20) {
      const r = runTaskShip({ dir, advance: true, advanceOpts: { skipPlanReview: true } })
      visited.push(r.phase)
      done = r.done
      guard++
    }
    expect(done).toBe(true)
    expect(visited).toEqual([
      'preflight',
      'plan',
      'red-team-review',
      'red',
      'green',
      'refactor',
      'verification',
      'close',
      'complete',
    ])
    expect(readUnifiedState(dir)?.phase).toBe('complete')
  })
})

// #1288 — de-self-only: steps are config-aware (target repo arbiter.json), and self-only
// authoring gates are SKIPPED (not faked) for consumer repos (INV-115 / ADR-093 §5).
const profile = (over: Partial<ShipProfile> = {}): ShipProfile => ({
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  // #1306 — orchestration prefs (default to the resolver floors).
  maxParallelWorktrees: 1,
  defaultGateLevel: 'L1',
  affinityBatching: false,
  // #1730 — no companion by default; individual tests inject one.
  companions: [],
  ...over,
})
const SELF_ONLY_GATES = ['template-authoring', 'selfOnly-invariants', 'matrix-fixtures']

describe('ship complete-action — (collaborationMode × mergeMode) matrix (#1288 RT-02)', () => {
  it('trunk-solo + direct → push to default branch, NO PR', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({
        collaborationMode: 'trunk-solo',
        mergeMode: 'direct',
      }),
    ).action
    expect(a).toMatch(/no PR/i)
    expect(a).not.toMatch(/await|review/i)
  })

  it('trunk-solo + pr-ff → open PR + fast-forward', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({
        collaborationMode: 'trunk-solo',
        mergeMode: 'pr-ff',
      }),
    ).action
    expect(a).toMatch(/PR/)
    expect(a).toMatch(/fast-forward/i)
    expect(a).not.toMatch(/await required review/i)
  })

  it('peer-review → open PR, await required review + checks', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({ collaborationMode: 'peer-review' }),
    ).action
    expect(a).toMatch(/PR/)
    expect(a).toMatch(/await required review/i)
  })

  it('gated-review + solo.mergeMode:direct → STILL PR + review (override forced safe, RT-02)', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({
        collaborationMode: 'gated-review',
        mergeMode: 'direct',
      }),
    ).action
    expect(a).toMatch(/PR/)
    expect(a).toMatch(/await required review/i)
    expect(a).not.toMatch(/no PR/i)
  })
})

describe('ship verification — self-only gates skipped, not faked (#1288 RT-06)', () => {
  it('arbiter-self → verification carries the 3 self-only authoring gates', () => {
    const step = shipStepFor('verification', 'Standard', profile({ isArbiterSelf: true }))
    expect(step.selfOnlyChecks).toEqual(SELF_ONLY_GATES)
  })

  it('consumer → verification selfOnlyChecks is empty (skipped, not faked)', () => {
    const step = shipStepFor('verification', 'Standard', profile({ isArbiterSelf: false }))
    expect(step.selfOnlyChecks ?? []).toEqual([])
  })
})

// #1306 — the three orchestration prefs are CONSUMED in the ship step plan (not dead):
// verification reads defaultGateLevel; plan reads affinityBatching + maxParallelWorktrees.
describe('ship steps consume the #1306 profile prefs (RT-1306-05 — not dead code)', () => {
  it('verification gate command + action reflect defaultGateLevel', () => {
    const l2 = shipStepFor('verification', 'Standard', profile({ defaultGateLevel: 'L2' }))
    expect(l2.command).toContain('L2')
    expect(l2.action).toContain('L2')
    const l1 = shipStepFor('verification', 'Standard', profile({ defaultGateLevel: 'L1' }))
    expect(l1.command).toContain('L1')
  })

  it('plan action advises a parallel wave when affinityBatching is on AND >1 worktrees', () => {
    const step = shipStepFor(
      'plan',
      'Standard',
      profile({ affinityBatching: true, maxParallelWorktrees: 4 }),
    )
    expect(step.action).toContain('4')
    expect(step.action).toMatch(/parallel|wave/i)
  })

  it('plan action stays single-issue when affinityBatching is off', () => {
    const step = shipStepFor(
      'plan',
      'Standard',
      profile({ affinityBatching: false, maxParallelWorktrees: 3 }),
    )
    expect(step.action).not.toMatch(/parallel worktrees/i)
  })

  it('plan action stays single-issue when batching is on but only 1 worktree allowed (trunk-solo)', () => {
    const step = shipStepFor(
      'plan',
      'Standard',
      profile({ affinityBatching: true, maxParallelWorktrees: 1, collaborationMode: 'trunk-solo' }),
    )
    expect(step.action).not.toMatch(/parallel worktrees/i)
  })
})

describe('buildShipStepLines — honest self-only + governance render (#1288 RT-06/08)', () => {
  const size = 'Standard'
  const resultFor = (p: ShipProfile): ShipResult => ({
    phase: 'verification',
    step: shipStepFor('verification', 'Standard', p),
    advanced: false,
    done: false,
    profile: p,
  })

  it('self → prints a Self-only checks line naming the gates', () => {
    const lines = buildShipStepLines(resultFor(profile({ isArbiterSelf: true })), size)
    const joined = lines.join('\n')
    expect(joined).toMatch(/Self-only checks:/)
    for (const g of SELF_ONLY_GATES) expect(joined).toContain(g)
  })

  it('consumer → NO Self-only checks line and NONE of the gate names leak (INV-115)', () => {
    const lines = buildShipStepLines(resultFor(profile({ isArbiterSelf: false })), size)
    const joined = lines.join('\n')
    expect(joined).not.toMatch(/Self-only checks:/)
    for (const g of SELF_ONLY_GATES) expect(joined).not.toContain(g)
  })

  it('always prints a Governance line (governanceLevel is consumed, not dead — RT-08)', () => {
    const lines = buildShipStepLines(resultFor(profile({ governanceLevel: 'L3' })), size)
    expect(lines.join('\n')).toMatch(/Governance:\s*L3/)
  })
})

// #1730 — /ship composes with active companion plugins (green-phase instruction) and announces
// them (Companion: line). Absent ⇒ byte-identical to a companion-free ship.
describe('ship companion composition (#1730)', () => {
  const size = 'Standard'
  const testCompanion = {
    id: 'ponytail:ponytail',
    label: 'ponytail',
    mode: 'full' as const,
    policy: {
      label: 'ponytail',
      defaultMode: 'full' as const,
      greenInstruction: 'DRAFT-LAZY {mode}',
    },
  }
  const stepFor = (p: ShipProfile): ShipResult => ({
    phase: 'green',
    step: shipStepFor('green', 'Standard', p),
    advanced: false,
    done: false,
    profile: p,
  })

  it('green action appends the companion instruction (with mode substituted) when one is active', () => {
    const a = shipStepFor('green', 'Standard', profile({ companions: [testCompanion] })).action
    expect(a).toMatch(/Implement the minimum/)
    expect(a).toContain('DRAFT-LAZY full')
  })

  it('substitutes {mode} in the REAL registry ponytail instruction (no token survives)', () => {
    const ponytail = SKILLS_MATRIX.find((e) => e.id === 'ponytail:ponytail')?.companion
    if (!ponytail) throw new Error('ponytail companion policy missing from SKILLS_MATRIX')
    const real = {
      id: 'ponytail:ponytail',
      label: ponytail.label,
      mode: 'lite' as const,
      policy: ponytail,
    }
    const a = shipStepFor('green', 'Standard', profile({ companions: [real] })).action
    expect(a).toContain('lite mode')
    expect(a).not.toContain('{mode}')
    expect(a).toMatch(/gates remain the safety net/i)
  })

  it('green action is byte-identical to the base string when no companion is active', () => {
    expect(shipStepFor('green', 'Standard', profile({ companions: [] })).action).toBe(
      'Implement the minimum to make the tests pass.',
    )
  })

  it('prints a Companion: line naming the active companion and mode', () => {
    const lines = buildShipStepLines(stepFor(profile({ companions: [testCompanion] })), size)
    expect(lines.join('\n')).toMatch(/Companion:\s*ponytail \(full\)/)
  })

  it('prints NO Companion: line for a companion-free ship (surfaced, not faked)', () => {
    const lines = buildShipStepLines(stepFor(profile({ companions: [] })), size)
    expect(lines.join('\n')).not.toMatch(/Companion:/)
  })
})

describe('ship companion evidence emission (#1745)', () => {
  const testCompanion = {
    id: 'ponytail:ponytail',
    label: 'ponytail',
    mode: 'full' as const,
    policy: {
      label: 'ponytail',
      defaultMode: 'full' as const,
      greenInstruction: 'DRAFT-LAZY {mode}',
    },
  }

  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('writes companion evidence when ship enters verification with an active companion', () => {
    runTaskShip({ dir, taskId: '#1745', tier: 'S' })
    writeUnifiedState(dir, { phase: 'verification' })

    runTaskShip({
      dir,
      profileOverride: profile({
        isArbiterSelf: false,
        companions: [testCompanion],
      }),
      gatherCompanionDiffStats: () => ({ files: 2, insertions: 5, deletions: 1 }),
      recordedAt: '2026-07-03T00:00:00.000Z',
    })

    const path = companionEvidencePath('#1745', dir)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toMatchObject({
      companions: [{ id: 'ponytail:ponytail', mode: 'full' }],
      diffStats: { files: 2, insertions: 5, deletions: 1 },
      recordedAt: '2026-07-03T00:00:00.000Z',
    })
  })

  it('does not write companion evidence without active companions', () => {
    runTaskShip({ dir, taskId: '#1745', tier: 'S' })
    writeUnifiedState(dir, { phase: 'verification' })
    runTaskShip({
      dir,
      profileOverride: profile({ isArbiterSelf: false, companions: [] }),
      gatherCompanionDiffStats: () => ({ files: 2, insertions: 5, deletions: 1 }),
    })
    expect(existsSync(companionEvidencePath('#1745', dir))).toBe(false)
  })
})
