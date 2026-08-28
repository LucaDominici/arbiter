// SPDX-License-Identifier: Apache-2.0
// #2357 — the /ship-facing CLI boundary must reach the external-review invoker.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectExternalModel } from '../../src/detectors/external-model.js'
import { invokeExternalReview } from '../../src/integrations/external-review.js'
import { resolveShipProfile } from '../../src/commands/ship-profile.js'
import {
  runCrossModelReview,
  runShipCrossModelReview,
} from '../../src/commands/cross-model-review.js'
import { runCli } from '../../src/utils/run-cli.js'

vi.mock('../../src/detectors/external-model.js', () => ({
  detectExternalModel: vi.fn(),
}))
vi.mock('../../src/integrations/external-review.js', () => ({
  invokeExternalReview: vi.fn(),
}))
vi.mock('../../src/commands/ship-profile.js', () => ({
  resolveShipProfile: vi.fn(),
}))
vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCli: vi.fn() }
})

const mockedDetect = vi.mocked(detectExternalModel)
const mockedInvoke = vi.mocked(invokeExternalReview)
const mockedProfile = vi.mocked(resolveShipProfile)
const mockedRunCli = vi.mocked(runCli)

const cfg = {
  enabled: true,
  diffEgressConsent: true,
  providers: ['codex'] as const,
  slots: { codeReview: 1, redTeamReview: 0 },
  timeoutMs: 300_000,
  onUnavailable: 'degrade' as const,
}

describe('runCrossModelReview (#2357)', () => {
  beforeEach(() => {
    mockedInvoke.mockClear()
    mockedRunCli.mockReset()
    mockedDetect.mockReturnValue({
      provider: 'codex',
      vendor: 'openai',
      available: true,
      authenticated: true,
      version: '1.2.3',
      error: null,
    })
    mockedProfile.mockReturnValue({
      isArbiterSelf: false,
      collaborationMode: 'peer-review',
      mergeMode: 'pr-ff',
      governanceLevel: 'L2',
      autonomy: 'L0',
      defaultGateLevel: 'L1',
      companions: [],
      crossModelReview: cfg,
    })
    mockedInvoke.mockReturnValue({
      provider: 'codex',
      status: 'fulfilled',
      diffBytes: 4,
      diffTruncated: false,
      degradationReasons: [],
      recorded: true,
      envelope: { verdict: 'PASS', confidence: 1, findings: [], refutations: [] },
    })
    mockedRunCli.mockReturnValue({ stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 })
  })

  it('passes the configured profile, detected access, and stdin diff to the invoker', () => {
    const result = runCrossModelReview({
      dir: '/tmp/project',
      taskId: '#2357',
      prompt: 'Review this change.',
      diff: 'diff',
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'security',
    })

    expect(result.status).toBe('fulfilled')
    expect(mockedProfile).toHaveBeenCalledWith('/tmp/project')
    expect(mockedDetect).toHaveBeenCalledWith('codex')
    expect(mockedInvoke).toHaveBeenCalledWith({
      repoRoot: '/tmp/project',
      taskId: '#2357',
      prompt: 'Review this change.',
      diff: 'diff',
      cfg,
      access: expect.anything(),
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'security',
    })
  })

  it.each([
    ['disabled', { ...cfg, enabled: false }],
    ['without consent', { ...cfg, diffEgressConsent: false }],
  ])('refuses to invoke when cross-model review is %s', (_label, crossModelReview) => {
    mockedProfile.mockReturnValue({
      ...mockedProfile.mock.results[0]?.value,
      crossModelReview,
    })

    expect(() =>
      runCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2357',
        prompt: 'Review.',
        diff: 'diff',
      }),
    ).toThrow(/crossModelReview|consent/i)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('ships the configured external review from the real refactor boundary', () => {
    const result = runShipCrossModelReview({
      dir: '/tmp/project',
      taskId: '#2357',
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'security',
      cfg,
      access: mockedDetect.mock.results[0]?.value,
    })

    expect(result.status).toBe('fulfilled')
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['diff', '--binary', 'origin/main...HEAD'],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    expect(mockedInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ repoRoot: '/tmp/project', taskId: '#2357', diff: 'diff', cfg }),
    )
  })

  it('records a consent degradation without collecting or sending a diff', () => {
    const noConsent = { ...cfg, diffEgressConsent: false }
    runShipCrossModelReview({
      dir: '/tmp/project',
      taskId: '#2357',
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'security',
      cfg: noConsent,
    })

    expect(mockedRunCli).not.toHaveBeenCalled()
    expect(mockedInvoke).toHaveBeenCalledWith(expect.objectContaining({ diff: '', cfg: noConsent }))
    expect(mockedInvoke.mock.calls[0]?.[0]).not.toHaveProperty('access')
  })
})
