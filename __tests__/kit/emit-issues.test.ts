// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock run-cli before importing emit-issues (CANON-12)
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
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
  it('returns created:0 when W1 is empty', async () => {
    const plan = makeWavePlan([])
    const result = await emitWaveIssues(plan, false)
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('does not call runCli when W1 is empty', async () => {
    const plan = makeWavePlan([])
    await emitWaveIssues(plan, false)
    expect(runCli).not.toHaveBeenCalled()
  })
})

// ─── Creates one issue per W1 dim ─────────────────────────────────────────────

describe('emitWaveIssues — with W1 dims', () => {
  it('calls runCli once per W1 dim', async () => {
    const plan = makeWavePlan([
      { dimId: 'N03', category: 'static-analysis' },
      { dimId: 'N07', category: 'testing' },
    ])
    const result = await emitWaveIssues(plan, false)
    expect(runCli).toHaveBeenCalledTimes(2)
    expect(result.created).toBe(2)
  })

  it('gh issue command contains dim ID in title', async () => {
    const plan = makeWavePlan([{ dimId: 'N03', category: 'static-analysis' }])
    await emitWaveIssues(plan, false)
    const [cmd, args] = (runCli as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]]
    const fullCmd = `${cmd} ${args.join(' ')}`
    expect(fullCmd).toContain('N03')
  })

  it('uses gh issue create subcommand', async () => {
    const plan = makeWavePlan([{ dimId: 'N01', category: 'testing' }])
    await emitWaveIssues(plan, false)
    const [cmd] = (runCli as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]]
    expect(cmd).toBe('gh')
  })
})

// ─── dryRun=true logs but does NOT call runCli ────────────────────────────────

describe('emitWaveIssues — dry-run mode', () => {
  it('does not call runCli in dry-run mode', async () => {
    const plan = makeWavePlan([{ dimId: 'N03', category: 'static-analysis' }])
    await emitWaveIssues(plan, true)
    expect(runCli).not.toHaveBeenCalled()
  })

  it('returns skipped count equal to W1 dim count in dry-run', async () => {
    const plan = makeWavePlan([
      { dimId: 'N03', category: 'static-analysis' },
      { dimId: 'N07', category: 'testing' },
    ])
    const result = await emitWaveIssues(plan, true)
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(2)
  })
})
