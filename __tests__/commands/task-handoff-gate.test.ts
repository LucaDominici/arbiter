// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { runTaskAdvance, HandoffRequiredError, BudgetBreachError } from '../../src/commands/task.js'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'

vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({
    modelSwitch: true,
    transcriptPath: null,
  }),
}))

vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
}))

describe('task advance --to red: handoff gate (#703, C1 #1206)', () => {
  const dirs: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(phase = 'red-team-review'): string {
    const d = mkdtempSync(join(tmpdir(), 'task-handoff-test-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeUnifiedState(d, { taskId: '#703', phase: phase as never })
    return d
  }

  it('throws HandoffRequiredError on first red-team-review → red crossing with modelSwitch', () => {
    const dir = tmpRepo('red-team-review')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(HandoffRequiredError)
  })

  it('throws HandoffRequiredError on red-team-rework → red crossing with modelSwitch', () => {
    const dir = tmpRepo('red-team-rework')
    expect(() => runTaskAdvance({ to: 'red', dir, reverse: true })).toThrow(HandoffRequiredError)
  })

  it('records handoff metadata WITHOUT advancing phase on STOP (C1)', () => {
    const dir = tmpRepo('red-team-review')
    try {
      runTaskAdvance({ to: 'red', dir })
    } catch {
      // expected
    }
    const state = readUnifiedState(dir)
    expect(typeof state?.planningHandoffReady).toBe('string')
    expect(state?.handoffStrategy).toBe('interactive')
    expect(state?.handoffReady).toBe(true)
    // C1: the phase must NOT advance to red — that would short-circuit the post-clear budget gate.
    expect(state?.phase).toBe('red-team-review')
  })

  it('advances to red when ARBITER_POST_CLEAR=1 and planningHandoffReady set', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    expect(() => runTaskAdvance({ to: 'red', dir })).not.toThrow()
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('sets postClearResumed after --post-clear re-entry', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    runTaskAdvance({ to: 'red', dir })
    expect(typeof readUnifiedState(dir)?.postClearResumed).toBe('string')
  })

  it('re-entry is idempotent (does not overwrite postClearResumed)', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    const firstResumed = '2026-05-18T10:05:00.000Z'
    writeUnifiedState(dir, {
      planningHandoffReady: '2026-05-18T10:00:00.000Z',
      postClearResumed: firstResumed,
    })
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.postClearResumed).toBe(firstResumed)
  })

  it('skips STOP and sets handoffStrategy=inline when modelSwitch=false (CI/no-CC)', async () => {
    const { detectHostCapabilities } = vi.mocked(
      await import('../../src/capabilities/host-probe.js'),
    )
    detectHostCapabilities.mockReturnValueOnce({
      modelSwitch: false,
      transcriptPath: null,
    })
    const dir = tmpRepo('red-team-review')
    expect(() => runTaskAdvance({ to: 'red', dir })).not.toThrow()
    const state = readUnifiedState(dir)
    expect(state?.handoffStrategy).toBe('inline')
    expect(state?.phase).toBe('red')
  })

  it('does not interfere with non-planning → red transitions (e.g. refactor → red)', () => {
    const dir = tmpRepo('refactor')
    expect(() => runTaskAdvance({ to: 'red', dir, reverse: true })).not.toThrow()
  })

  it('budget breach does NOT write postClearResumed and leaves phase un-advanced (write-order)', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    // Over-budget cost evidence so runBudgetCheck throws
    const costDir = join(dir, '.arbiter', 'evidence', 'cost')
    mkdirSync(costDir, { recursive: true })
    writeFileSync(
      join(costDir, '#703.json'),
      JSON.stringify({
        taskId: '#703',
        byPhase: { red: { in: 999_999, out: 1_000, samples: 1 } },
        totals: { in: 999_999, out: 1_000, samples: 1 },
      }),
      'utf-8',
    )
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(BudgetBreachError)
    const state = readUnifiedState(dir)
    expect(state?.postClearResumed).toBeUndefined()
    expect(state?.phase).toBe('red-team-review')
  })
})
