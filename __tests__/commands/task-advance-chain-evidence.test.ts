// SPDX-License-Identifier: Apache-2.0
/**
 * #2331 — a chain of N issues must produce N pieces of RED evidence.
 *
 * `checkTddEvidenceGate` verifies exactly ONE task id. With `--chain` (#2102) that leaves the
 * other N−1 issues' RED evidence completely ungated: they land on the same branch, in the same
 * gate, in the same PR, with nothing asserting a test ever failed for them first. The hole exists
 * today; batching only makes it routine.
 *
 * WHERE the sweep goes is the whole design question. A chain traverses the phase machine ONCE —
 * one `phase` cursor, forward-only advance — so at `→ green` only the primary issue has been
 * implemented and only its evidence can exist. Requiring the whole chain there would deadlock
 * every train at its first issue. It goes at `→ verification`, where all N are implemented, as
 * the evidence peer of the per-id commit-subject scan pre-push already performs.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { runTaskAdvance } from '../../src/commands/task.js'

vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  resolveEvidenceCommit: vi.fn((ev: { test_commit_sha: string }) => ({
    sha: ev.test_commit_sha,
    healed: false,
  })),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
}))

const evidenceFor = (id: string): Record<string, unknown> => ({
  $schemaVersion: 1,
  task_id: id,
  test_path: `__tests__/evidence/${id.replace('#', '')}.test.ts`,
  test_commit_sha: 'a'.repeat(40),
  test_run_log: `FAIL __tests__/evidence/${id.replace('#', '')}.test.ts\n✗ 1 test failed`,
  observed_failure: 'FAIL',
  recorded_at: '2026-08-22T00:00:00.000Z',
})

describe('task advance: per-issue TDD evidence across a chain (#2331)', () => {
  const dirs: string[] = []
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(phase: string, chainIds: string[]): string {
    const d = mkdtempSync(join(tmpdir(), 'task-chain-ev-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(d, '.claude', '.task', 'status.json'),
      JSON.stringify({
        taskId: '#100',
        phase,
        tier: 'S',
        plan: '',
        cursor: { tddPhase: null, lastAction: '', nextAction: '' },
        handoffStrategy: 'inline',
        handoffReady: false,
        runId: 'test',
        timestamps: {},
        gateDecisions: [],
        chainIds,
      }),
      'utf-8',
    )
    return d
  }

  function writeEvidence(dir: string, id: string): void {
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, `${id}.json`), JSON.stringify(evidenceFor(id)), 'utf-8')
  }

  function writeGatePass(dir: string): void {
    // Not a real marker — the chain sweep must reject before the gate-pass check is consulted,
    // so an operator missing a test is told THAT, not "go run the gate".
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'gate-pass.json'), '{}', 'utf-8')
  }

  it('rejects advancing to verification when a chained issue has no RED evidence', () => {
    const dir = tmpRepo('refactor', ['#101'])
    writeEvidence(dir, '#100')
    writeGatePass(dir)
    expect(() => runTaskAdvance({ to: 'verification', dir })).toThrow(/#101/)
  })

  it('names every issue that is missing evidence, not just the first', () => {
    const dir = tmpRepo('refactor', ['#101', '#102'])
    writeEvidence(dir, '#100')
    writeGatePass(dir)
    let message = ''
    try {
      runTaskAdvance({ to: 'verification', dir })
    } catch (err) {
      message = String((err as Error).message)
    }
    expect(message).toContain('#101')
    expect(message).toContain('#102')
  })

  it('does NOT block the same chain at green — only the primary is implemented there', () => {
    // The deadlock guard. If this ever starts throwing, a train can never leave issue 1.
    const dir = tmpRepo('red', ['#101', '#102'])
    writeEvidence(dir, '#100')
    expect(() => runTaskAdvance({ to: 'green', dir })).not.toThrow()
  })

  it('rejects a chained issue whose evidence carries the wrong task_id', () => {
    const dir = tmpRepo('refactor', ['#101'])
    writeEvidence(dir, '#100')
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    writeFileSync(join(evDir, '#101.json'), JSON.stringify(evidenceFor('#999')), 'utf-8')
    writeGatePass(dir)
    expect(() => runTaskAdvance({ to: 'verification', dir })).toThrow(/#101|task_id/)
  })

  it('rejects a chained issue whose test never actually failed', () => {
    const dir = tmpRepo('refactor', ['#101'])
    writeEvidence(dir, '#100')
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    writeFileSync(
      join(evDir, '#101.json'),
      JSON.stringify({ ...evidenceFor('#101'), test_run_log: 'all good, 5 passed' }),
      'utf-8',
    )
    writeGatePass(dir)
    expect(() => runTaskAdvance({ to: 'verification', dir })).toThrow(/failure signature|#101/)
  })

  it('leaves an unchained task exactly as it was — no chain, no new requirement', () => {
    const dir = tmpRepo('refactor', [])
    writeEvidence(dir, '#100')
    // Verification runs the gate; the marker is required when leaving verification for close.
    expect(() => runTaskAdvance({ to: 'verification', dir })).not.toThrow()
  })
})
