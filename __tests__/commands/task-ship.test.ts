// SPDX-License-Identifier: Apache-2.0
//
// `/ship` orchestrator sequencing (#1206): step computation + auto-advance over the existing engine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import {
  runTaskShip,
  shipSequence,
  shipStepFor,
  nextPhase,
  buildShipStepLines,
  type ShipResult,
} from '../../src/commands/task-ship.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'
import type { ShipProfile } from '../../src/commands/ship-profile.js'
import type { ResolvedSize } from '../../src/sizing/diff-signals.js'

// Gates that would otherwise require a real repo / model switch
vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({ modelSwitch: false, transcriptPath: null }),
}))
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
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

describe('ship sequencing — pure plan', () => {
  it('shipSequence covers all eight forward phases in order', () => {
    const seq = shipSequence('Standard')
    expect(seq.map((s) => s.phase)).toEqual([
      'preflight',
      'plan',
      'red-team-review',
      'red',
      'green',
      'refactor',
      'verification',
      'complete',
    ])
  })

  it('dispatches tier-N red-team agents at red-team-review', () => {
    expect(shipStepFor('red-team-review', 'XS').reviewAgents).toBe(1)
    expect(shipStepFor('red-team-review', 'S').reviewAgents).toBe(2)
    expect(shipStepFor('red-team-review', 'Standard').reviewAgents).toBe(3)
  })

  it('dispatches tier-N code-review agents at refactor', () => {
    expect(shipStepFor('refactor', 'XS').reviewAgents).toBe(3)
    expect(shipStepFor('refactor', 'Standard').reviewAgents).toBe(4)
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

  it('omitted profile defaults consumer-safe: no self-only gates leak in the generic preview (RT-07)', () => {
    const seq = shipSequence('Standard') // no profile
    const verification = seq.find((s) => s.phase === 'verification')
    expect(verification?.selfOnlyChecks ?? []).toEqual([])
  })
})

describe('buildShipStepLines — honest self-only + governance render (#1288 RT-06/08)', () => {
  const size: ResolvedSize = {
    tier: 'Standard',
    verticals: ['bugs', 'type-safety', 'domain'],
    source: 'default',
  }
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
