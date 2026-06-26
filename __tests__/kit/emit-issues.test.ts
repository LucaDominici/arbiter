// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock run-cli before importing emit-issues (CANON-12)
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn().mockReturnValue({ stdout: '', stderr: '', exitCode: 0 }),
}))

import { emitWaveIssues } from '../../src/kit/emit-issues.js'
import { runCli } from '../../src/utils/run-cli.js'
import type { WavePlan } from '../../src/kit/wave-engine.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWavePlan(w1Dims: { dimId: string; category: string }[] = []): WavePlan {
  return {
    brownfieldClass: 'gold',
    waves: [
      { label: 'W0', goal: 'Bootstrap', dimensions: [] },
      {
        label: 'W1',
        goal: 'Enforcement',
        dimensions: w1Dims.map((d) => ({ ...d, status: 'P' as const })),
      },
      { label: 'W2', goal: 'Advanced', dimensions: [] },
      { label: 'W3', goal: 'Gold', dimensions: [] },
    ],
    summary: {
      totalDims: w1Dims.length,
      byWave: { W0: 0, W1: w1Dims.length, W2: 0, W3: 0 },
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

// ─── No issues when W1 empty ──────────────────────────────────────────────────

describe('emitWaveIssues', () => {
  it('returns created:0 when W1 is empty', () => {
    const plan = makeWavePlan([])
    const result = emitWaveIssues(plan, false)
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('does not call runCli when W1 is empty', () => {
    const plan = makeWavePlan([])
    emitWaveIssues(plan, false)
    expect(runCli).not.toHaveBeenCalled()
  })
})

// ─── Creates one issue per W1 dim ─────────────────────────────────────────────

/** Find the `gh issue create` calls among all runCli invocations. */
function createCalls(): Array<[string, string[]]> {
  return (runCli as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
    (c as [string, string[]])[1]?.includes('create'),
  ) as Array<[string, string[]]>
}

describe('emitWaveIssues — with W1 dims', () => {
  it('creates one issue per W1 dim', () => {
    const plan = makeWavePlan([
      { dimId: 'N03', category: 'static-analysis' },
      { dimId: 'N07', category: 'testing' },
    ])
    const result = emitWaveIssues(plan, false)
    expect(createCalls()).toHaveLength(2)
    expect(result.created).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('queries existing issues once before creating (dedup probe)', () => {
    const plan = makeWavePlan([{ dimId: 'N03', category: 'static-analysis' }])
    emitWaveIssues(plan, false)
    const listCalls = (runCli as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      (c as [string, string[]])[1]?.includes('list'),
    )
    expect(listCalls).toHaveLength(1)
  })

  it('gh issue command contains dim ID in title', () => {
    const plan = makeWavePlan([{ dimId: 'N03', category: 'static-analysis' }])
    emitWaveIssues(plan, false)
    const [cmd, args] = createCalls()[0]
    const fullCmd = `${cmd} ${args.join(' ')}`
    expect(fullCmd).toContain('N03')
  })

  it('uses gh issue create subcommand', () => {
    const plan = makeWavePlan([{ dimId: 'N01', category: 'testing' }])
    emitWaveIssues(plan, false)
    const [cmd] = createCalls()[0]
    expect(cmd).toBe('gh')
  })
})

// ─── Idempotency: existing issues are not duplicated (#1575) ───────────────────

describe('emitWaveIssues — idempotency', () => {
  it('skips a dim whose issue already exists and creates none for it', () => {
    const mocked = runCli as ReturnType<typeof vi.fn>
    // First call is the `gh issue list` dedup probe — return an existing N03 issue.
    mocked.mockImplementationOnce(() => ({
      stdout: JSON.stringify([{ title: 'kit(#1043): enforce N03' }]),
      stderr: '',
      exitCode: 0,
    }))
    const plan = makeWavePlan([{ dimId: 'N03', category: 'static-analysis' }])
    const result = emitWaveIssues(plan, false)
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(1)
    expect(createCalls()).toHaveLength(0)
  })

  it('creates only the missing dim when some already exist', () => {
    const mocked = runCli as ReturnType<typeof vi.fn>
    mocked.mockImplementationOnce(() => ({
      stdout: JSON.stringify([{ title: 'kit(#1043): enforce N03' }]),
      stderr: '',
      exitCode: 0,
    }))
    const plan = makeWavePlan([
      { dimId: 'N03', category: 'static-analysis' },
      { dimId: 'N07', category: 'testing' },
    ])
    const result = emitWaveIssues(plan, false)
    expect(result.created).toBe(1)
    expect(result.skipped).toBe(1)
    const created = createCalls()
    expect(created).toHaveLength(1)
    expect(`${created[0][0]} ${created[0][1].join(' ')}`).toContain('N07')
  })

  it('counts a create that throws as failed without aborting the rest', () => {
    const mocked = runCli as ReturnType<typeof vi.fn>
    // list probe → no existing issues
    mocked.mockImplementationOnce(() => ({ stdout: '[]', stderr: '', exitCode: 0 }))
    // first create throws, second succeeds
    mocked.mockImplementationOnce(() => {
      throw new Error('gh: not authenticated')
    })
    mocked.mockImplementationOnce(() => ({ stdout: '', stderr: '', exitCode: 0 }))
    const plan = makeWavePlan([
      { dimId: 'N03', category: 'static-analysis' },
      { dimId: 'N07', category: 'testing' },
    ])
    const result = emitWaveIssues(plan, false)
    expect(result.failed).toBe(1)
    expect(result.created).toBe(1)
  })
})

// ─── dryRun=true logs but does NOT call runCli ────────────────────────────────

describe('emitWaveIssues — dry-run mode', () => {
  it('does not call runCli in dry-run mode', () => {
    const plan = makeWavePlan([{ dimId: 'N03', category: 'static-analysis' }])
    emitWaveIssues(plan, true)
    expect(runCli).not.toHaveBeenCalled()
  })

  it('returns skipped count equal to W1 dim count in dry-run', () => {
    const plan = makeWavePlan([
      { dimId: 'N03', category: 'static-analysis' },
      { dimId: 'N07', category: 'testing' },
    ])
    const result = emitWaveIssues(plan, true)
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(2)
  })
})
