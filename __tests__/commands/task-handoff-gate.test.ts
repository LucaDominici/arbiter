// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { runTaskAdvance, HandoffRequiredError, BudgetBreachError } from '../../src/commands/task.js'

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

describe('task advance --to red: handoff gate (#703)', () => {
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
    writeFileSync(join(d, '.claude', '.task-id'), '#703\n', 'utf-8')
    writeFileSync(join(d, '.claude', '.task-phase'), phase + '\n', 'utf-8')
    mkdirSync(join(d, '.claude', '.task-_703'), { recursive: true })
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

  it('writes planningHandoffReady to status.json on STOP', () => {
    const dir = tmpRepo('red-team-review')
    try {
      runTaskAdvance({ to: 'red', dir })
    } catch {
      // expected
    }
    const statusPath = join(dir, '.claude', '.task-_703', 'status.json')
    expect(existsSync(statusPath)).toBe(true)
    const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
      planningHandoffReady: string
      handoffStrategy: string
    }
    expect(typeof status.planningHandoffReady).toBe('string')
    expect(status.handoffStrategy).toBe('interactive')
  })

  it('writes flat-file .task-handoff-ready on STOP', () => {
    const dir = tmpRepo('red-team-review')
    try {
      runTaskAdvance({ to: 'red', dir })
    } catch {
      // expected
    }
    expect(existsSync(join(dir, '.claude', '.task-handoff-ready'))).toBe(true)
  })

  it('advances normally when ARBITER_POST_CLEAR=1 and planningHandoffReady set', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    const statusPath = join(dir, '.claude', '.task-_703', 'status.json')
    writeFileSync(
      statusPath,
      JSON.stringify({ planningHandoffReady: '2026-05-18T10:00:00.000Z' }),
      'utf-8',
    )
    expect(() => runTaskAdvance({ to: 'red', dir })).not.toThrow()
  })

  it('sets postClearResumed after --post-clear re-entry', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    const statusPath = join(dir, '.claude', '.task-_703', 'status.json')
    writeFileSync(
      statusPath,
      JSON.stringify({ planningHandoffReady: '2026-05-18T10:00:00.000Z' }),
      'utf-8',
    )
    runTaskAdvance({ to: 'red', dir })
    const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as { postClearResumed: string }
    expect(typeof status.postClearResumed).toBe('string')
  })

  it('re-entry is idempotent (second call via checkHandoffGate does not overwrite postClearResumed)', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    // Keep phase as red-team-review so advance actually reaches checkHandoffGate
    const dir = tmpRepo('red-team-review')
    const statusPath = join(dir, '.claude', '.task-_703', 'status.json')
    const firstResumed = '2026-05-18T10:05:00.000Z'
    writeFileSync(
      statusPath,
      JSON.stringify({
        planningHandoffReady: '2026-05-18T10:00:00.000Z',
        postClearResumed: firstResumed,
      }),
      'utf-8',
    )
    runTaskAdvance({ to: 'red', dir })
    const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as { postClearResumed: string }
    expect(status.postClearResumed).toBe(firstResumed)
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
    const statusPath = join(dir, '.claude', '.task-_703', 'status.json')
    const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as { handoffStrategy: string }
    expect(status.handoffStrategy).toBe('inline')
  })

  it('does not interfere with non-planning → red transitions (e.g. refactor → red)', () => {
    const dir = tmpRepo('refactor')
    expect(() => runTaskAdvance({ to: 'red', dir, reverse: true })).not.toThrow()
  })

  it('budget breach does NOT write postClearResumed (write-order invariant)', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    const statusPath = join(dir, '.claude', '.task-_703', 'status.json')
    writeFileSync(
      statusPath,
      JSON.stringify({ planningHandoffReady: '2026-05-18T10:00:00.000Z' }),
      'utf-8',
    )
    // Write over-budget cost evidence so runBudgetCheck throws
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
    const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as Record<string, unknown>
    expect(status['postClearResumed']).toBeUndefined()
  })
})
