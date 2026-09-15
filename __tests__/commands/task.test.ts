import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({
    modelSwitch: false,
    transcriptPath: null,
  }),
}))
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { runTaskAdvance, runTaskInit } from '../../src/commands/task.js'
import { runTaskShip } from '../../src/commands/task-ship.js'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'

describe('runTaskAdvance', () => {
  let dir: string

  // #2435: `preflight` promises seeded task state and every later evidence gate keys on the
  // id, so the fixture carries one — an id-less document is now refused at the plan edge.
  const seed = (phase: TaskPhase) => writeUnifiedState(dir, { phase, taskId: '#1' })
  const phaseOf = () => readUnifiedState(dir)?.phase

  /** #2435: the artifact `red-team-review` promises (ship.md §Red-team review). */
  const recordRedTeam = (taskId = '#1') => {
    mkdirSync(join(dir, '.arbiter', 'evidence', 'redteam'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'evidence', 'redteam', `${taskId}.json`),
      JSON.stringify({ findings: [] }),
      'utf-8',
    )
  }

  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('happy path: preflight → plan advances phase in the unified document', () => {
    seed('preflight')
    runTaskAdvance({ to: 'plan', dir })
    expect(phaseOf()).toBe('plan')
  })

  it('happy path: plan → red-team-review → red advances phase', () => {
    seed('plan')
    runTaskAdvance({ to: 'red-team-review', dir })
    recordRedTeam()
    runTaskAdvance({ to: 'red', dir, skipPlanReview: true })
    expect(phaseOf()).toBe('red')
  })

  it('appends to log.md with ISO timestamp and prev → next', () => {
    seed('preflight')
    const before = new Date()
    runTaskAdvance({ to: 'plan', dir })
    const log = readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')
    expect(log).toContain('preflight → plan')
    expect(log).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    const ts = new Date(log.trim().split(' ')[1])
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('illegal skip: preflight → red fails', () => {
    seed('preflight')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/illegal.*skip|cannot advance/i)
  })

  it('backward transition blocked without --reverse', () => {
    seed('red')
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/backward.*--reverse|use --reverse/i)
  })

  it('--reverse allows backward transition', () => {
    seed('red')
    runTaskAdvance({ to: 'plan', dir, reverse: true })
    expect(phaseOf()).toBe('plan')
  })

  it('no-op when already at target phase', () => {
    seed('plan')
    expect(() => runTaskAdvance({ to: 'plan', dir })).not.toThrow()
    expect(phaseOf()).toBe('plan')
  })

  it('--reverse does not permit forward skip', () => {
    seed('preflight')
    expect(() => runTaskAdvance({ to: 'verification', dir, reverse: true })).toThrow(
      /illegal.*skip|cannot advance/i,
    )
  })

  it('unknown --to value throws', () => {
    seed('plan')
    expect(() => runTaskAdvance({ to: 'nonexistent' as never, dir })).toThrow(
      /unknown.*phase|invalid.*to/i,
    )
  })

  it('refuses a direct lifecycle advance while no-progress remains BLOCKED', () => {
    seed('plan')
    expect(() =>
      runTaskShip({
        dir,
        executionOutcome: 'no-progress',
        gatherTierSignals: () => ({
          blastRadius: 0,
          callerCount: 0,
          changedFiles: ['docs/guide.md'],
          complete: true,
          labels: [],
          milestoneBundled: false,
        }),
      }),
    ).toThrow(/BLOCKED.*no progress/i)

    expect(() => runTaskAdvance({ to: 'red-team-review', dir })).toThrow(/BLOCKED.*no progress/i)
    expect(phaseOf()).toBe('plan')
  })

  it('AC-7 runTaskInit normalizes a new bare id and resets stale completed state', () => {
    writeUnifiedState(dir, {
      taskId: '#2120',
      phase: 'complete',
      plan: '.claude/plans/old.md',
      branch: 'tmp-red',
    })
    runTaskInit({ dir, id: '2135', tier: 'Standard', plan: '.claude/plans/2135.md' })
    expect(readUnifiedState(dir)).toMatchObject({
      taskId: '#2135',
      phase: 'preflight',
      tier: 'Standard',
      plan: '.claude/plans/2135.md',
    })
  })

  it('persists the schema-validated collaboration mode for delivery guards', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(makeConfig(dir, { collaborationMode: 'trunk-solo' })),
    )

    runTaskInit({ dir, id: '#2681', tier: 'Standard' })

    expect(readUnifiedState(dir)?.collaborationMode).toBe('trunk-solo')
  })
})

// Multi-issue state needs the affinity and qualification admission available only through ship.
describe('runTaskInit — refuses chainIds', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('refuses a single --chain id and directs the caller through ship', () => {
    expect(() => runTaskInit({ dir, id: '#2102', chainIds: ['2103'] })).toThrow(
      /SEALED: affinity.*arbiter ship/,
    )
    expect(readUnifiedState(dir)).toBeNull()
  })

  it('refuses multiple --chain ids without a partial write', () => {
    expect(() => runTaskInit({ dir, id: '#2102', chainIds: ['2103', '#2104'] })).toThrow(
      /SEALED: affinity.*arbiter ship/,
    )
    expect(readUnifiedState(dir)).toBeNull()
  })

  it('rejects a non-numeric chain id the same way the primary ship id is validated', () => {
    expect(() => runTaskInit({ dir, id: '#2102', chainIds: ['feature-x'] })).toThrow(
      /invalid chain id/i,
    )
    // Rejected before any write — state stays untouched.
    expect(readUnifiedState(dir)?.chainIds).toBeUndefined()
  })

  it('no --chain given → chainIds stays unset (no-op)', () => {
    runTaskInit({ dir, id: '#2102' })
    expect(readUnifiedState(dir)?.chainIds).toBeUndefined()
  })
})
