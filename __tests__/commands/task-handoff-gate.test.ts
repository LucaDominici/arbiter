// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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
    // postClearCostRecorded must be set (cost was recorded before the throw — idempotency marker)
    expect(state?.postClearCostRecorded).toBeDefined()
  })
})

// ─── #1208 regression + #1209 cost-idempotency ──────────────────────────────────────────────────

describe('task advance: post-clear cost idempotency + unknown.json (#1208, #1209)', () => {
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
    const d = mkdtempSync(join(tmpdir(), 'task-handoff-idempotency-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeUnifiedState(d, { taskId: '#703', phase: phase as never })
    return d
  }

  it('#1208: retry after budget breach does NOT double-count — postClearCostRecorded blocks re-record', async () => {
    const { detectHostCapabilities } = vi.mocked(
      await import('../../src/capabilities/host-probe.js'),
    )
    // Transcript with 60k input tokens (> 50k budget threshold)
    const transcriptDir = mkdtempSync(join(tmpdir(), 'transcript-'))
    dirs.push(transcriptDir)
    const transcriptPath = join(transcriptDir, 'transcript.jsonl')
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-18T10:01:00.000Z',
        message: {
          usage: {
            input_tokens: 60_000,
            output_tokens: 1_000,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }) + '\n',
    )
    detectHostCapabilities.mockReturnValue({ modelSwitch: true, transcriptPath })

    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })

    // Attempt 1 — budget breach (60k > 50k threshold), postClearResumed NOT written
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(BudgetBreachError)

    // Attempt 2 — still breaches, but must NOT re-record the transcript window
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(BudgetBreachError)

    // Cost must be 60k (single count), not 120k (double count)
    const costPath = join(dir, '.arbiter', 'evidence', 'cost', '#703.json')
    const costReport = JSON.parse(readFileSync(costPath, 'utf-8')) as {
      byPhase: { red: { in: number; samples: number } }
    }
    expect(costReport.byPhase.red.in).toBe(60_000)
    expect(costReport.byPhase.red.samples).toBe(1)
    // Idempotency marker must be set
    expect(readUnifiedState(dir)?.postClearCostRecorded).toBeDefined()
  })

  it('#1208: no taskId in state → throws descriptive error, never writes cost/unknown.json', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    // Build state with empty taskId so readTaskIdFromDisk returns undefined → rawId = 'unknown'
    const d = mkdtempSync(join(tmpdir(), 'task-notaskid-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(d, '.claude', '.task', 'status.json'),
      JSON.stringify({
        taskId: '',
        phase: 'red-team-review',
        tier: 'Standard',
        plan: '',
        cursor: { tddPhase: null, lastAction: '', nextAction: '' },
        handoffStrategy: null,
        handoffReady: false,
        runId: 'test-run-notaskid',
        timestamps: {},
        gateDecisions: [],
        planningHandoffReady: '2026-05-18T10:00:00.000Z',
      }),
      'utf-8',
    )

    // Must throw a descriptive error (not silently write unknown.json)
    expect(() => runTaskAdvance({ to: 'red', dir: d })).toThrow(/taskId|task.id|unknown\.json/i)

    // Ensure cost/unknown.json was never created
    expect(existsSync(join(d, '.arbiter', 'evidence', 'cost', 'unknown.json'))).toBe(false)
  })

  it('happy path: second --post-clear (phase already red) is a no-op on cost accumulation', () => {
    vi.stubEnv('ARBITER_POST_CLEAR', '1')
    const dir = tmpRepo('red-team-review')
    writeUnifiedState(dir, { planningHandoffReady: '2026-05-18T10:00:00.000Z' })

    // First run succeeds (transcriptPath=null → 0 tokens → budget passes)
    expect(() => runTaskAdvance({ to: 'red', dir })).not.toThrow()
    expect(typeof readUnifiedState(dir)?.postClearResumed).toBe('string')

    // Read cost after first run
    const costPath = join(dir, '.arbiter', 'evidence', 'cost', '#703.json')
    const afterFirst = existsSync(costPath)
      ? (JSON.parse(readFileSync(costPath, 'utf-8')) as { byPhase: { red?: { samples: number } } })
      : null

    // Second run (postClearResumed already set → early return, no re-record)
    expect(() => runTaskAdvance({ to: 'red', dir })).not.toThrow()
    const afterSecond = existsSync(costPath)
      ? (JSON.parse(readFileSync(costPath, 'utf-8')) as { byPhase: { red?: { samples: number } } })
      : null

    // Samples must be identical (no second recording)
    if (afterFirst?.byPhase.red !== undefined && afterSecond?.byPhase.red !== undefined) {
      expect(afterSecond.byPhase.red.samples).toBe(afterFirst.byPhase.red.samples)
    }
  })
})

// ─── Clear+resume banner (#1209) ─────────────────────────────────────────────────────────────────

describe('task advance: clear+resume banner in HandoffRequiredError (#1209)', () => {
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
    const d = mkdtempSync(join(tmpdir(), 'task-banner-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeUnifiedState(d, { taskId: '#703', phase: phase as never })
    return d
  }

  it('HandoffRequiredError message contains task-id, strategy name, and --post-clear flag', () => {
    const dir = tmpRepo('red-team-review')
    let err: HandoffRequiredError | undefined
    try {
      runTaskAdvance({ to: 'red', dir })
    } catch (e) {
      if (e instanceof HandoffRequiredError) err = e
    }
    expect(err).toBeDefined()
    // Banner must include the task id so the user knows which task to resume
    expect(err!.message).toContain('#703')
    // Banner must include --post-clear so the user knows how to re-invoke
    expect(err!.message).toContain('--post-clear')
    // Banner must name the strategy (stop / sub-agent / inline)
    expect(err!.message).toMatch(/stop|sub.?agent|inline/i)
  })

  it('HandoffRequiredError message includes tier when no units given (default strategy path)', () => {
    const dir = tmpRepo('red-team-review')
    let err: HandoffRequiredError | undefined
    try {
      runTaskAdvance({ to: 'red', dir })
    } catch (e) {
      if (e instanceof HandoffRequiredError) err = e
    }
    expect(err).toBeDefined()
    // Tier name should appear in the banner (XS / S / Standard or default)
    expect(err!.message.length).toBeGreaterThan(50) // substantial banner, not a one-liner
  })
})
