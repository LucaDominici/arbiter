// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Force a no-model-switch host by default so the handoff gate never throws
// HandoffRequiredError on the planning→red crossing unless a test opts in.
vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({
    modelSwitch: false,
    transcriptPath: null,
  }),
}))

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
  decideClearStrategy,
  buildHandoffBanner,
  HandoffRequiredError,
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
  // #2435: leaving a red-team phase now asserts the evidence ship.md promises that phase
  // records, so a fixture seeded AT one stands for a red team that actually ran. Written for
  // both the seeded id and the `unknown` fallback the sanitiser produces for an id-less doc.
  if (fields.phase !== 'red-team-review' && fields.phase !== 'red-team-rework') return
  const evDir = join(dir, '.arbiter', 'evidence', 'redteam')
  mkdirSync(evDir, { recursive: true })
  const ids = [fields.taskId, 'unknown'].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
  for (const id of ids) {
    writeFileSync(join(evDir, `${id}.json`), JSON.stringify({ findings: [] }), 'utf-8')
  }
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
    expect(out).toContain('manual MCP context')
  })

  it('BACKLOG.md present → Layer-1 contents are emitted', () => {
    const dir = tmpRepo()
    const blDir = join(dir, '.arbiter', 'evidence', '5')
    mkdirSync(blDir, { recursive: true })
    writeFileSync(join(blDir, 'BACKLOG.md'), 'BACKLOG-BODY-MARKER', 'utf-8')
    const runner = makeRunner(() => '')
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '5', runner }))
    expect(out).toContain('Layer 1: BACKLOG.md')
    expect(out).toContain('BACKLOG-BODY-MARKER')
    expect(out).toContain('END Layer 1')
  })

  it('empty git stdout → "(no matching CHECKPOINT commits)" and "(no commits)"', () => {
    const dir = tmpRepo()
    const runner = makeRunner(() => '')
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

  it('taskId read from disk when none passed in opts', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#88', phase: 'red' })
    const runner = makeRunner(() => '')
    const out = captureStdout(() => runTaskRecover({ dir, runner }))
    expect(out).toContain('Recovery for task #88')
  })

  it('empty-string taskId in opts → falls back to disk lookup', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#77', phase: 'red' })
    const runner = makeRunner(() => '')
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '', runner }))
    expect(out).toContain('Recovery for task #77')
  })
})

// ─── plan-review gate (via runTaskAdvance --to red) ────────────────────────────────────────────────

describe('checkPlanReviewGate (advance --to red)', () => {
  function enableGate(dir: string): void {
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'plan-review.enabled'), '', 'utf-8')
  }
  // sanitizeTaskId('#5') → '_5'; the gate reads/writes under the sanitised id.
  function planReviewDir(dir: string): string {
    return join(dir, '.arbiter', 'evidence', 'plan-review', '_5')
  }
  function writeLatest(dir: string, obj: unknown): void {
    const prDir = planReviewDir(dir)
    mkdirSync(prDir, { recursive: true })
    writeFileSync(join(prDir, 'latest.json'), JSON.stringify(obj), 'utf-8')
  }

  it('gate disabled (no marker) → advance proceeds to red', () => {
    const dir = tmpRepo()
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('gate enabled, no plan-review evidence → throws with "no plan-review evidence"', () => {
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/plan-review gate.*no plan-review evidence/s)
  })

  it('gate enabled, verdict PASS → advance proceeds', () => {
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    writeLatest(dir, { verdict: 'PASS' })
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('gate enabled, verdict FAIL → throws with the prior verdict', () => {
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    writeLatest(dir, { verdict: 'FAIL' })
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/verdict was FAIL/)
  })

  it('gate enabled, unreadable latest.json → throws "unreadable latest.json"', () => {
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    const prDir = planReviewDir(dir)
    mkdirSync(prDir, { recursive: true })
    writeFileSync(join(prDir, 'latest.json'), '{ not json', 'utf-8')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/unreadable latest\.json/)
  })

  it('--skip-plan-review flag → bypass record + stderr warning, advance proceeds', () => {
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    const err = captureStderr(() => runTaskAdvance({ to: 'red', dir, skipPlanReview: true }))
    expect(err).toMatch(/reason=flag/)
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('ARBITER_SKIP_PLAN_REVIEW=1 (not CI) → env bypass record + warning', () => {
    vi.stubEnv('ARBITER_SKIP_PLAN_REVIEW', '1')
    vi.stubEnv('CI', 'false')
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    const err = captureStderr(() => runTaskAdvance({ to: 'red', dir }))
    expect(err).toMatch(/reason=env/)
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('ARBITER_SKIP_PLAN_REVIEW=1 under CI → env bypass refused, gate still fires', () => {
    vi.stubEnv('ARBITER_SKIP_PLAN_REVIEW', '1')
    vi.stubEnv('CI', 'true')
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { taskId: '#5', phase: 'red-team-review' })
    // env bypass disabled under CI → no evidence → gate throws, and hint mentions CI refusal
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/refused under CI/)
  })

  it('plan digest mismatch → throws "plan changed since last review"', () => {
    const dir = tmpRepo()
    enableGate(dir)
    // Write a plan file and reference it in state; latest.json carries a stale digest.
    writeFileSync(join(dir, 'plan.md'), 'PLAN CONTENT v2', 'utf-8')
    seed(dir, { taskId: '#5', phase: 'red-team-review', plan: 'plan.md' })
    writeLatest(dir, { verdict: 'PASS', planDigest: '0'.repeat(64) })
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/plan changed since last review/)
  })

  it('no taskId on disk → sanitises "unknown" and still evaluates the gate', () => {
    const dir = tmpRepo()
    enableGate(dir)
    seed(dir, { phase: 'red-team-review' }) // taskId left empty
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/plan-review gate/)
  })
})

// ─── decideClearStrategy (pure) ──────────────────────────────────────────────────────────────────

describe('decideClearStrategy', () => {
  it('no model switch → inline regardless of units', () => {
    expect(decideClearStrategy({ units: 999, modelSwitch: false })).toBe('inline')
  })
  it('model switch + units undefined → stop (conservative default)', () => {
    expect(decideClearStrategy({ units: undefined, modelSwitch: true })).toBe('stop')
  })
  it('model switch + small units → inline', () => {
    expect(decideClearStrategy({ units: 5, modelSwitch: true })).toBe('inline')
  })
  it('model switch + units at INLINE_MAX boundary (10) → inline', () => {
    expect(decideClearStrategy({ units: 10, modelSwitch: true })).toBe('inline')
  })
  it('model switch + medium units → sub-agent', () => {
    expect(decideClearStrategy({ units: 15, modelSwitch: true })).toBe('sub-agent')
  })
  it('model switch + units at SUBAGENT_MAX boundary (20) → sub-agent', () => {
    expect(decideClearStrategy({ units: 20, modelSwitch: true })).toBe('sub-agent')
  })
  it('model switch + large units → stop', () => {
    expect(decideClearStrategy({ units: 50, modelSwitch: true })).toBe('stop')
  })
})

// ─── buildHandoffBanner (pure) ───────────────────────────────────────────────────────────────────

describe('buildHandoffBanner', () => {
  it('inline strategy → "Continue in this context" hint, strips leading #', () => {
    const banner = buildHandoffBanner({
      taskId: '#42',
      strategy: 'inline',
      units: 3,
      tier: 'XS',
    })
    expect(banner).toContain('Continue in this context')
    expect(banner).toContain('ship #42')
    expect(banner).toContain('(tier: XS)')
    expect(banner).toContain('units: 3')
  })

  it('sub-agent strategy → "Spawn a sub-agent" hint', () => {
    const banner = buildHandoffBanner({
      taskId: '42',
      strategy: 'sub-agent',
      units: undefined,
      tier: undefined,
    })
    expect(banner).toContain('Spawn a sub-agent')
    // no tier / units info segments when both undefined
    expect(banner).not.toContain('(tier:')
    expect(banner).not.toContain('units:')
  })

  it('stop strategy → numbered /clear instructions', () => {
    const banner = buildHandoffBanner({
      taskId: '#9',
      strategy: 'stop',
      units: 30,
      tier: 'Standard',
    })
    expect(banner).toContain('Run: /clear')
    expect(banner).toContain('Re-invoke')
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
    seed(dir, { phase: 'plan' })
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

  it('lateral target (red-team-rework) bypasses ordinal ordering checks', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'red-team-review' })
    runTaskAdvance({ to: 'red-team-rework', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red-team-rework')
  })

  it('lateral current (red-team-rework → red-team-review) is allowed', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'red-team-rework' })
    runTaskAdvance({ to: 'red-team-review', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red-team-review')
  })

  it('plan → red-team-review (plan-review gate disabled) advances and logs the transition', () => {
    const dir = tmpRepo()
    seed(dir, { phase: 'plan' })
    runTaskAdvance({ to: 'red-team-review', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red-team-review')
  })
})

// ─── handoff gate (model switch + post-clear) ────────────────────────────────────────────────────

describe('handoff branches (advance --to red)', () => {
  async function withModelSwitch(transcriptPath: string | null = null): Promise<void> {
    const { detectHostCapabilities } = vi.mocked(
      await import('../../src/capabilities/host-probe.js'),
    )
    detectHostCapabilities.mockReturnValue({ modelSwitch: true, transcriptPath })
  }

  it('model switch + planning→red, no units → HandoffRequiredError (stop strategy)', async () => {
    await withModelSwitch()
    const dir = tmpRepo()
    seed(dir, { taskId: '#703', phase: 'red-team-review' })
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(HandoffRequiredError)
    // phase must NOT advance (C1)
    expect(readUnifiedState(dir)?.phase).toBe('red-team-review')
  })

  it('model switch + small units → inline → advances without throwing', async () => {
    await withModelSwitch()
    const dir = tmpRepo()
    seed(dir, { taskId: '#703', phase: 'red-team-review' })
    runTaskAdvance({ to: 'red', dir, units: 3 })
    expect(readUnifiedState(dir)?.phase).toBe('red')
    expect(readUnifiedState(dir)?.handoffStrategy).toBe('inline')
  })

  it('post-clear re-entry (ARBITER_POST_CLEAR=1) advances to red and sets postClearResumed', async () => {
    await withModelSwitch()
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo()
    seed(dir, { taskId: '#703', phase: 'red-team-review', planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
    expect(typeof readUnifiedState(dir)?.postClearResumed).toBe('string')
  })

  it('post-clear re-entry is idempotent once postClearResumed is set', async () => {
    await withModelSwitch()
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo()
    const stamp = '2026-05-18T11:00:00.000Z'
    seed(dir, {
      taskId: '#703',
      phase: 'red-team-review',
      planningHandoffReady: '2026-05-18T10:00:00.000Z',
      postClearResumed: stamp,
    })
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.postClearResumed).toBe(stamp)
  })

  it('post-clear with no taskId in state → descriptive throw', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo()
    seed(dir, { phase: 'red-team-review', planningHandoffReady: '2026-05-18T10:00:00.000Z' })
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/taskId/)
  })

  it('non-planning current → red (refactor → red, reverse) does NOT trigger the handoff gate', async () => {
    await withModelSwitch()
    const dir = tmpRepo()
    seed(dir, { taskId: '#703', phase: 'refactor' })
    // refactor → red is backward + non-planning current: handoff gate is not invoked.
    runTaskAdvance({ to: 'red', dir, reverse: true })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })
})
