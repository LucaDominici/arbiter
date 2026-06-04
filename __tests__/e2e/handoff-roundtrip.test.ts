// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, afterEach, vi } from 'vitest'
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

describe('handoff roundtrip E2E (#703)', () => {
  const dirs: string[] = []

  afterEach(() => {
    vi.unstubAllEnvs()
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(phase = 'red-team-review'): string {
    const d = mkdtempSync(join(tmpdir(), 'handoff-e2e-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeUnifiedState(d, { taskId: '#703', phase: phase as never })
    return d
  }

  function writeCostEvidence(dir: string, firstPhaseTokens: number, samples: number): void {
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'cost')
    mkdirSync(evidenceDir, { recursive: true })
    const report = {
      taskId: '#703',
      byPhase: { red: { in: firstPhaseTokens, out: 1000, samples } },
      totals: { in: firstPhaseTokens, out: 1000, samples },
    }
    writeFileSync(join(evidenceDir, '#703.json'), JSON.stringify(report, null, 2) + '\n', 'utf-8')
  }

  it('full roundtrip: STOP on first crossing, resume on post-clear', () => {
    const dir = tmpRepo('red-team-review')

    // Step 1: first crossing → STOP, metadata recorded, phase NOT advanced (C1)
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(HandoffRequiredError)
    const status = readUnifiedState(dir)
    expect(status?.handoffStrategy).toBe('interactive')
    expect(typeof status?.planningHandoffReady).toBe('string')
    expect(status?.phase).toBe('red-team-review')

    // Step 2: simulate /clear → new session → post-clear re-entry advances to red
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    vi.stubEnv('ARBITER_COST_BUDGET_SKIP', '1')
    expect(() => runTaskAdvance({ to: 'red', dir })).not.toThrow()
    const status2 = readUnifiedState(dir)
    expect(typeof status2?.postClearResumed).toBe('string')
    expect(status2?.phase).toBe('red')
  })

  it('budget assertion passes when cost evidence is under threshold', () => {
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    writeCostEvidence(dir, 10_000, 5)

    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    expect(() => runTaskAdvance({ to: 'red', dir })).not.toThrow()
  })

  it('budget assertion blocks when cost evidence is over threshold', () => {
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    writeCostEvidence(dir, 80_000, 3)

    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(BudgetBreachError)
  })

  it('--skip-budget bypasses hard breach', () => {
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    writeCostEvidence(dir, 80_000, 3)

    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    expect(() => runTaskAdvance({ to: 'red', dir, skipBudget: true })).not.toThrow()
  })

  it('cost evidence file written during post-clear re-entry', () => {
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })

    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    runTaskAdvance({ to: 'red', dir })

    const costPath = join(dir, '.arbiter', 'evidence', 'cost', '#703.json')
    expect(existsSync(costPath)).toBe(true)
  })
})

describe('handoff via CLI subprocess (#703)', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'handoff-cli-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeUnifiedState(d, { taskId: '#703', phase: 'red-team-review' })
    return d
  }

  it('CLI exits 78 on handoff STOP (modelSwitch=true via CLAUDECODE)', () => {
    const dir = tmpRepo()
    const result = spawnSync(
      'node',
      ['dist/cli.js', 'task', 'advance', '--to', 'red', '--dir', dir],
      {
        encoding: 'utf-8',
        env: { ...process.env, CLAUDECODE: '1', ARBITER_SKIP_PLAN_REVIEW: '1' },
      },
    )
    expect(result.status).toBe(78)
  })

  it('CLI exits 79 on budget breach (modelSwitch=false, over-threshold evidence)', () => {
    const dir = tmpRepo()
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'cost')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, '#703.json'),
      JSON.stringify({
        taskId: '#703',
        byPhase: { red: { in: 80_000, out: 1000, samples: 3 } },
        totals: { in: 80_000, out: 1000, samples: 3 },
      }),
      'utf-8',
    )
    const result = spawnSync(
      'node',
      ['dist/cli.js', 'task', 'advance', '--post-clear', '--to', 'red', '--dir', dir],
      {
        encoding: 'utf-8',
        env: { ...process.env, CLAUDECODE: '0', ARBITER_SKIP_PLAN_REVIEW: '1' },
      },
    )
    expect(result.status).toBe(79)
  })
})
