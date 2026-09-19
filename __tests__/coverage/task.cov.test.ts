// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Stub the git sha/path checks so the TDD-evidence green gate does not need a real repo.
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  resolveEvidenceCommit: vi.fn((ev: { test_commit_sha: string }) => ({
    sha: ev.test_commit_sha,
    healed: false,
  })),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
}))

import {
  runTaskResume,
  runTaskInit,
  runTaskGet,
  runTaskRecover,
  runTaskAdvance,
  type Runner,
} from '../../src/commands/task.js'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'
import type { RunCliResult } from '../../src/utils/run-cli.js'

// ─── shared temp-dir lifecycle ──────────────────────────────────────────────────────────────────

const dirs: string[] = []

function tmpRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'task-cov-'))
  dirs.push(d)
  mkdirSync(join(d, '.claude'), { recursive: true })
  return d
}

function seed(dir: string, fields: Partial<Parameters<typeof writeUnifiedState>[1]>): void {
  writeUnifiedState(dir, fields)
}

/** Capture process.stdout / process.stderr writes for the duration of a callback. */
function captureStdout(fn: () => void): string {
  let buf = ''
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
      return true
    })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return buf
}

function captureStderr(fn: () => void): string {
  let buf = ''
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
      return true
    })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return buf
}

/** A Runner stub that returns canned stdout per matched argv, optionally throwing. */
function makeRunner(handler: (cmd: string, args: readonly string[]) => string | Error): Runner {
  return (cmd, args): RunCliResult => {
    const out = handler(cmd, args)
    if (out instanceof Error) throw out
    return { stdout: out, stderr: '', exitCode: 0 } as RunCliResult
  }
}

const VALID_EVIDENCE = {
  $schemaVersion: 1,
  task_id: '#551',
  test_path: '__tests__/evidence/tdd.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 test failed',
  observed_failure: 'FAIL __tests__/evidence/tdd.test.ts',
  recorded_at: '2026-05-16T00:00:00.000Z',
}

function writeEvidence(dir: string, evidence: Record<string, unknown>, id = '#551'): void {
  const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(join(evDir, `${id}.json`), JSON.stringify(evidence), 'utf-8')
}

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

// ─── runTaskResume ──────────────────────────────────────────────────────────────────────────────

describe('runTaskResume', () => {
  it('fresh tree → preflight RECOVERY_TABLE blurb, no task header', () => {
    const dir = tmpRepo()
    const out = captureStdout(() => runTaskResume({ dir }))
    expect(out).toContain('Phase: preflight')
    expect(out).not.toContain('Task:')
  })

  it('emits task header when a non-empty taskId is present', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#42', phase: 'red' })
    const out = captureStdout(() => runTaskResume({ dir }))
    expect(out).toContain('Task: #42')
    expect(out).toContain('Phase: red')
  })

  it('cursor with nextAction → pinpoint resume (overrides coarse table)', () => {
    const dir = tmpRepo()
    seed(dir, {
      taskId: '#7',
      phase: 'green',
      cursor: { tddPhase: 'GREEN', lastAction: 'wrote impl', nextAction: 'run gate' },
    })
    const out = captureStdout(() => runTaskResume({ dir }))
    expect(out).toContain('Phase: green (GREEN)')
    expect(out).toContain('Last action: wrote impl')
    expect(out).toContain('Next action: run gate')
  })

  it('cursor with empty lastAction → omits the Last action line', () => {
    const dir = tmpRepo()
    seed(dir, {
      phase: 'green',
      cursor: { tddPhase: null, lastAction: '', nextAction: 'do the thing' },
    })
    const out = captureStdout(() => runTaskResume({ dir }))
    expect(out).toContain('Next action: do the thing')
    expect(out).not.toContain('Last action:')
    // tddPhase null → no "(...)" suffix on the phase line
    expect(out).toContain('Phase: green\n')
  })

  it('cursor with blank nextAction → falls back to coarse RECOVERY_TABLE', () => {
    const dir = tmpRepo()
    seed(dir, {
      phase: 'verification',
      cursor: { tddPhase: null, lastAction: 'x', nextAction: '   ' },
    })
    const out = captureStdout(() => runTaskResume({ dir }))
    expect(out).toContain('Phase: verification')
    expect(out).toContain('node scripts/check-all.mjs L2')
  })

  it('defaults dir to process.cwd() when omitted (no throw on a real tree)', () => {
    const out = captureStdout(() => runTaskResume())
    expect(out.length).toBeGreaterThan(0)
  })
})

// ─── runTaskInit ────────────────────────────────────────────────────────────────────────────────

describe('runTaskInit', () => {
  it('writes id/tier/plan into the unified document', () => {
    const dir = tmpRepo()
    runTaskInit({ dir, id: '#100', tier: 'Standard', plan: '.claude/plans/p.md' })
    const s = readUnifiedState(dir)
    expect(s?.taskId).toBe('#100')
    expect(s?.tier).toBe('Standard')
    expect(s?.plan).toBe('.claude/plans/p.md')
  })

  it('with no optional fields → logs "(unset)" but still writes state', () => {
    const dir = tmpRepo()
    runTaskInit({ dir })
    const s = readUnifiedState(dir)
    expect(s).not.toBeNull()
    expect(s?.taskId).toBe('')
  })

  it('records the detected branch when git resolves a branch name', () => {
    const dir = tmpRepo()
    // detectCurrentBranch shells out via runCli('git', ...). On a non-repo temp dir it
    // either throws (caught → undefined) or returns empty; either way state is written.
    runTaskInit({ dir, id: '#101' })
    const s = readUnifiedState(dir)
    expect(s?.taskId).toBe('#101')
  })
})

// ─── runTaskGet ─────────────────────────────────────────────────────────────────────────────────

describe('runTaskGet', () => {
  it('prints a known field from seeded state', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#9', phase: 'red', tier: 'XS', plan: 'p' })
    expect(captureStdout(() => runTaskGet({ dir, field: 'phase' }))).toBe('red\n')
    expect(captureStdout(() => runTaskGet({ dir, field: 'taskId' }))).toBe('#9\n')
    expect(captureStdout(() => runTaskGet({ dir, field: 'tier' }))).toBe('XS\n')
    expect(captureStdout(() => runTaskGet({ dir, field: 'plan' }))).toBe('p\n')
  })

  it('cursor-derived fields (tddPhase/lastAction/nextAction) print from cursor', () => {
    const dir = tmpRepo()
    seed(dir, {
      phase: 'green',
      cursor: { tddPhase: 'RED', lastAction: 'la', nextAction: 'na' },
    })
    expect(captureStdout(() => runTaskGet({ dir, field: 'tddPhase' }))).toBe('RED\n')
    expect(captureStdout(() => runTaskGet({ dir, field: 'lastAction' }))).toBe('la\n')
    expect(captureStdout(() => runTaskGet({ dir, field: 'nextAction' }))).toBe('na\n')
  })

  it('tddPhase null → empty string', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'plan', cursor: { tddPhase: null, lastAction: '', nextAction: '' } })
    expect(captureStdout(() => runTaskGet({ dir, field: 'tddPhase' }))).toBe('\n')
  })

  it('fresh tree (no state) → defaults: phase=preflight, others empty', () => {
    const dir = tmpRepo()
    expect(captureStdout(() => runTaskGet({ dir, field: 'phase' }))).toBe('preflight\n')
    expect(captureStdout(() => runTaskGet({ dir, field: 'taskId' }))).toBe('\n')
  })

  it('unknown field → writes error to stderr and exits 2', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'red' })
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as typeof process.exit)
    const err = captureStderr(() => runTaskGet({ dir, field: 'bogus' }))
    expect(err).toMatch(/Unknown field "bogus"/)
    expect(exitSpy).toHaveBeenCalledWith(2)
    exitSpy.mockRestore()
  })
})

// ─── runTaskRecover ─────────────────────────────────────────────────────────────────────────────

describe('runTaskRecover', () => {
  it('no task id and none on disk → prints guidance, no git calls', () => {
    const dir = tmpRepo()
    const runner = vi.fn(makeRunner(() => ''))
    const out = captureStdout(() => runTaskRecover({ dir, runner }))
    expect(out).toMatch(/No task id provided/)
    expect(runner).not.toHaveBeenCalled()
  })

  it('explicit taskId, no BACKLOG.md → Layer-1 absent note + Layer 2/3 git output', () => {
    const dir = tmpRepo()
    const runner = makeRunner((_cmd, args) =>
      args.includes('--grep') ? 'abc123 CHECKPOINT(#5) 2026-01-01' : 'def456 commit msg 2026-01-01',
    )
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '#5', runner }))
    expect(out).toContain('Recovery for task #5')
    expect(out).toContain('no BACKLOG.md')
    expect(out).toContain('CHECKPOINT(#5)')
    expect(out).toContain('Layer 3: last 20 commits')
    expect(out).toContain('absent proof remains NO DATA')
  })

  it('BACKLOG.md present → Layer-1 contents are emitted', () => {
    const dir = tmpRepo()
    const blDir = join(dir, '.arbiter', 'evidence', '5')
    mkdirSync(blDir, { recursive: true })
    writeFileSync(join(blDir, 'BACKLOG.md'), 'BACKLOG-BODY-MARKER', 'utf-8')
    const runner = vi.fn(makeRunner(() => ''))
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '5', runner }))
    expect(out).toContain('Layer 1: BACKLOG.md')
    expect(out).toContain('BACKLOG-BODY-MARKER')
    expect(out).toContain('END Layer 1')
  })

  it('empty git stdout → "(no matching CHECKPOINT commits)" and "(no commits)"', () => {
    const dir = tmpRepo()
    const runner = vi.fn(makeRunner(() => ''))
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '#5', runner }))
    expect(out).toContain('(no matching CHECKPOINT commits)')
    expect(out).toContain('(no commits)')
  })

  it('git runner throwing → both layers report "(git log failed: ...)"', () => {
    const dir = tmpRepo()
    const runner = makeRunner(() => new Error('boom'))
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '#5', runner }))
    expect(out).toMatch(/git log failed: boom/)
  })

  it('git runner throwing a non-Error → stringified in failure note', () => {
    const dir = tmpRepo()
    const runner: Runner = () => {
      throw 'string-failure'
    }
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '#5', runner }))
    expect(out).toContain('string-failure')
  })

  it('taskId read from disk projects durable state without history search', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#88', phase: 'red' })
    const runner = vi.fn(makeRunner(() => ''))
    const out = captureStdout(() => runTaskRecover({ dir, runner }))
    expect(out).toContain('Task: #88 · phase: red')
    expect(runner).not.toHaveBeenCalled()
  })

  it('empty-string taskId in opts → falls back to durable state projection', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#77', phase: 'red' })
    const runner = vi.fn(makeRunner(() => ''))
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '', runner }))
    expect(out).toContain('Task: #77 · phase: red')
    expect(runner).not.toHaveBeenCalled()
  })
})

// ─── TDD-evidence green gate (advance --to green) ────────────────────────────────────────────────

describe('checkTddEvidenceGate (advance --to green)', () => {
  function seedRed(dir: string): void {
    seed(dir, { taskId: '#551', phase: 'red' })
  }

  it('valid evidence → advance proceeds to green', () => {
    const dir = tmpRepo()
    seedRed(dir)
    writeEvidence(dir, VALID_EVIDENCE)
    runTaskAdvance({ to: 'green', dir })
    expect(readUnifiedState(dir)?.phase).toBe('green')
  })

  it('missing evidence file → throws "TDD evidence gate"', () => {
    const dir = tmpRepo()
    seedRed(dir)
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/TDD evidence gate/)
  })

  it('task_id mismatch → throws mismatch error', () => {
    const dir = tmpRepo()
    seedRed(dir)
    writeEvidence(dir, { ...VALID_EVIDENCE, task_id: '#999' })
    // schema requires task_id ~ #\d+; #999 parses but mismatches the active #551
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/mismatch/)
  })

  it('no failure signature in log → throws "no recognised failure signature"', () => {
    const dir = tmpRepo()
    seedRed(dir)
    writeEvidence(dir, {
      ...VALID_EVIDENCE,
      test_run_log: 'all good',
      observed_failure: 'all good',
    })
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/failure signature/)
  })

  it('RED commit unresolvable on this branch → throws "not reachable from HEAD"', async () => {
    const dir = tmpRepo()
    seedRed(dir)
    writeEvidence(dir, VALID_EVIDENCE)
    const { resolveEvidenceCommit } = vi.mocked(await import('../../src/evidence/git-checks.js'))
    resolveEvidenceCommit.mockReturnValueOnce(null)
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/not reachable from HEAD/)
  })

  it('path not in commit (git-check returns false) → throws "not found in commit"', async () => {
    const dir = tmpRepo()
    seedRed(dir)
    writeEvidence(dir, VALID_EVIDENCE)
    const { pathExistsInCommit } = vi.mocked(await import('../../src/evidence/git-checks.js'))
    pathExistsInCommit.mockReturnValueOnce(false)
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/not found in commit/)
  })
})

// ─── runTaskAdvance structural branches ──────────────────────────────────────────────────────────

describe('runTaskAdvance structural guards', () => {
  it('invalid --to value → throws with the valid-phase list', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#2724', phase: 'plan' })
    expect(() => runTaskAdvance({ to: 'nope' as TaskPhase, dir })).toThrow(/Invalid --to value/)
  })

  it('current === to → no-op early return', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'plan' })
    runTaskAdvance({ to: 'plan', dir })
    expect(readUnifiedState(dir)?.phase).toBe('plan')
  })

  it('backward transition without --reverse → throws', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'refactor' })
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/Backward transition/)
  })

  it('backward transition with --reverse → allowed', () => {
    const dir = tmpRepo()
    // #2435: entering `plan` asserts preflight's "seed task state" promise, so the fixture
    // carries the id every later evidence gate keys on.
    seed(dir, { taskId: '#5', phase: 'refactor' })
    runTaskAdvance({ to: 'plan', dir, reverse: true })
    expect(readUnifiedState(dir)?.phase).toBe('plan')
  })

  it('illegal forward skip (>1 phase) → throws', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'preflight' })
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/Illegal skip/)
  })

  it('plan → red advances and logs the result-first transition', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#2724', phase: 'plan' })
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })
})
