// SPDX-License-Identifier: Apache-2.0
// #2357 — the /ship-facing CLI boundary must reach the external-review invoker.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectExternalModel } from '../../src/detectors/external-model.js'
import { invokeExternalReview } from '../../src/integrations/external-review.js'
import { resolveShipProfile } from '../../src/commands/ship-profile.js'
import {
  runCrossModelReview,
  runShipCrossModelReview,
  writeExternalReviewSidecar,
} from '../../src/commands/cross-model-review.js'
import { runCli } from '../../src/utils/run-cli.js'

const REPO_ROOT = process.cwd()

vi.mock('../../src/detectors/external-model.js', () => ({
  detectExternalModel: vi.fn(),
}))
vi.mock('../../src/integrations/external-review.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/integrations/external-review.js')>()
  return { ...actual, invokeExternalReview: vi.fn() }
})
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
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const PLAN_REF = '.claude/plans/task-2747.md'
const FROZEN_REVIEW = { baseSha: BASE_SHA, headSha: HEAD_SHA, planRef: PLAN_REF }
const FROZEN_PLAN = [
  '# Plan',
  '## Acceptance Criteria',
  '- [ ] AC-2747.2: Preserve text and punctuation!',
  '- [ ] AC-2747.1: Second ordered criterion.',
  '## Non-Goals',
  '- Do not add a scheduler.',
  '## Verification contract',
  '- `npm test` is required.',
].join('\n')
const FROZEN_TDD = '{"task_id":"#2747","observed_failure":"expected RED"}'
const FROZEN_BRIEF_JSON = JSON.stringify({
  criteria: [
    { id: 'AC-2747.2', text: 'Preserve text and punctuation!' },
    { id: 'AC-2747.1', text: 'Second ordered criterion.' },
  ],
  nonGoals: ['Do not add a scheduler.'],
  acHash: 'frozen-ac-hash',
})

function mockFrozenShipCalls(): void {
  mockedRunCli.mockImplementation((command, args) => {
    if (command === 'git' && args[0] === 'status')
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD')
      return { stdout: `${HEAD_SHA}\n`, stderr: '', exitCode: 0, durationMs: 1 }
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'origin/main')
      return { stdout: `${BASE_SHA}\n`, stderr: '', exitCode: 0, durationMs: 1 }
    if (command === 'git' && args[0] === 'show')
      return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
    if (command === process.execPath)
      return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
    return { stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 }
  })
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
    mockFrozenShipCalls()
    const result = runShipCrossModelReview({
      dir: '/tmp/project',
      taskId: '#2357',
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'security',
      cfg,
      access: mockedDetect.mock.results[0]?.value,
      ...FROZEN_REVIEW,
    })

    expect(result.status).toBe('fulfilled')
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['diff', '--binary', `${BASE_SHA}..${HEAD_SHA}`],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    expect(mockedInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ repoRoot: '/tmp/project', taskId: '#2357', diff: 'diff', cfg }),
    )
  })

  it('builds the review prompt from the frozen plan and exact candidate range', () => {
    mockedRunCli.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'status')
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD')
        return { stdout: `${HEAD_SHA}\n`, stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'ls-tree')
        return {
          stdout: '.arbiter/evidence/tdd/#2747.json\n',
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      if (command === 'git' && args[0] === 'show')
        return {
          stdout: String(args[1]).includes('.arbiter/evidence/tdd/') ? FROZEN_TDD : FROZEN_PLAN,
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      if (command === process.execPath)
        return {
          stdout: JSON.stringify({
            criteria: [
              { id: 'AC-2747.2', text: 'Preserve text and punctuation!' },
              { id: 'AC-2747.1', text: 'Second ordered criterion.' },
            ],
            nonGoals: ['Do not add a scheduler.'],
            acHash: 'frozen-ac-hash',
          }),
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      if (command === 'git' && args[0] === 'diff')
        return { stdout: 'exact diff', stderr: '', exitCode: 0, durationMs: 1 }
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
    })

    runShipCrossModelReview({
      dir: '/tmp/project',
      taskId: '#2747',
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'bugs',
      cfg,
      ...FROZEN_REVIEW,
    })

    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['show', `${HEAD_SHA}:${PLAN_REF}`],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['diff', '--binary', `${BASE_SHA}..${HEAD_SHA}`],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    const prompt = mockedInvoke.mock.calls[0]?.[0].prompt ?? ''
    expect(prompt).toContain('Task: #2747')
    expect(prompt).toContain(`Base SHA: ${BASE_SHA}`)
    expect(prompt).toContain(`Head SHA: ${HEAD_SHA}`)
    expect(prompt).toContain('Acceptance criteria hash: frozen-ac-hash')
    expect(prompt).toContain(
      'Return acceptanceFit using schema arbiter-ac-fit-v1 with one verdict and candidate-file citation list for every criterion below',
    )
    expect(prompt).toContain('Do not block on unavailable local command execution')
    expect(prompt).toContain('Every blocking finding must cite a concrete candidate defect')
    expect(prompt).toContain('## Verification contract\n- `npm test` is required.')
    expect(prompt).toContain(FROZEN_TDD)
    expect(prompt.indexOf('AC-2747.2: Preserve text and punctuation!')).toBeLessThan(
      prompt.indexOf('AC-2747.1: Second ordered criterion.'),
    )
    expect(prompt).toContain('Non-goals:\n- Do not add a scheduler.')
  })

  it('fails closed when frozen TDD evidence cannot be inspected', () => {
    mockFrozenShipCalls()
    mockedRunCli.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'ls-tree') throw new Error('git unavailable')
      if (command === 'git' && args[0] === 'status')
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD')
        return { stdout: `${HEAD_SHA}\n`, stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'show')
        return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
      if (command === process.execPath)
        return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
      return { stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 }
    })

    expect(() =>
      runShipCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2747',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
        cfg,
        ...FROZEN_REVIEW,
      }),
    ).toThrow(/git unavailable/)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it.each([
    ['an unsafe task id', '#0', FROZEN_TDD, '(none recorded)'],
    ['an oversized RED receipt', '#2747', 'x'.repeat(17 * 1024), 'omitted: exceeds 16 KiB'],
  ])('bounds reviewer context for %s', (_label, taskId, receipt, expected) => {
    mockedRunCli.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'status')
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD')
        return { stdout: `${HEAD_SHA}\n`, stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'ls-tree')
        return {
          stdout: `.arbiter/evidence/tdd/${taskId}.json\n`,
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      if (command === 'git' && args[0] === 'show')
        return {
          stdout: String(args[1]).includes('.arbiter/evidence/tdd/') ? receipt : FROZEN_PLAN,
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      if (command === process.execPath)
        return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
      return { stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 }
    })

    runShipCrossModelReview({
      dir: '/tmp/project',
      taskId,
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'bugs',
      cfg,
      ...FROZEN_REVIEW,
    })

    expect(mockedInvoke.mock.calls[0]?.[0].prompt).toContain(expected)
  })

  it('rejects head drift before dispatch', () => {
    mockedRunCli.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'status')
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'rev-parse')
        return { stdout: `${'c'.repeat(40)}\n`, stderr: '', exitCode: 0, durationMs: 1 }
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
    })
    expect(() =>
      runShipCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2747',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
        cfg,
        ...FROZEN_REVIEW,
      }),
    ).toThrow(/HEAD.*frozen|drift/i)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it.each([null, ''])('rejects a missing frozen review head (%s)', (headSha) => {
    expect(() =>
      runShipCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2747',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
        cfg,
        ...FROZEN_REVIEW,
        headSha,
      }),
    ).toThrow(/frozen review HEAD is missing/i)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('rejects an empty review base', () => {
    mockFrozenShipCalls()
    expect(() =>
      runShipCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2747',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
        cfg,
        ...FROZEN_REVIEW,
        baseSha: '',
      }),
    ).toThrow(/review base SHA is unavailable/i)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('rejects head movement after diff collection and immediately before dispatch', () => {
    let headReads = 0
    mockFrozenShipCalls()
    mockedRunCli.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        headReads += 1
        return {
          stdout: `${headReads === 1 ? HEAD_SHA : 'c'.repeat(40)}\n`,
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      }
      if (command === 'git' && args[0] === 'status')
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'show')
        return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
      if (command === process.execPath)
        return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
      return { stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 }
    })

    expect(() =>
      runShipCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2747',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
        cfg,
        ...FROZEN_REVIEW,
      }),
    ).toThrow(/HEAD.*frozen|drift/i)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('rejects head movement after dispatch before writing evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-head-move-'))
    let headReads = 0
    try {
      mockedRunCli.mockImplementation((command, args) => {
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          headReads += 1
          return {
            stdout: `${headReads < 3 ? HEAD_SHA : 'c'.repeat(40)}\n`,
            stderr: '',
            exitCode: 0,
            durationMs: 1,
          }
        }
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref')
          return { stdout: 'task/#2747\n', stderr: '', exitCode: 0, durationMs: 1 }
        if (command === 'git' && args[0] === 'status')
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
        if (command === 'git' && args[0] === 'show')
          return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
        if (command === process.execPath)
          return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
        return { stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 }
      })

      expect(() =>
        runShipCrossModelReview({
          dir,
          taskId: '#2747',
          tier: 'Standard',
          phase: 'refactor',
          vertical: 'bugs',
          cfg,
          ...FROZEN_REVIEW,
        }),
      ).toThrow(/HEAD.*frozen|drift/i)
      expect(mockedInvoke).toHaveBeenCalledTimes(1)
      expect(existsSync(join(dir, '.arbiter', 'agents-dispatched.json'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves the first-round origin/main base before diff and prompt construction', () => {
    mockFrozenShipCalls()
    runShipCrossModelReview({
      dir: '/tmp/project',
      taskId: '#2747',
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'bugs',
      cfg,
      ...FROZEN_REVIEW,
      baseSha: null,
    })
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['rev-parse', 'origin/main'],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['diff', '--binary', `${BASE_SHA}..${HEAD_SHA}`],
      expect.objectContaining({ cwd: '/tmp/project' }),
    )
    expect(mockedInvoke.mock.calls[0]?.[0].prompt).toContain(`Base SHA: ${BASE_SHA}`)
  })

  it('refuses dispatch when the frozen plan reference is missing', () => {
    mockFrozenShipCalls()
    expect(() =>
      runShipCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2747',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
        cfg,
        ...FROZEN_REVIEW,
        planRef: '',
      }),
    ).toThrow(/frozen plan reference.*missing/i)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it.each([
    [
      'unreadable',
      () => {
        throw new Error('missing plan')
      },
    ],
    ['malformed', () => '{not-json'],
    ['no criteria', () => JSON.stringify({ criteria: [], nonGoals: ['x'], acHash: 'empty' })],
    ['a non-object', () => JSON.stringify(null)],
    [
      'a non-Error parser failure',
      () => {
        throw 'parser failed'
      },
    ],
  ])('refuses dispatch when the frozen plan is %s', (_label, parserResult) => {
    mockedRunCli.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'status')
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'rev-parse')
        return { stdout: `${HEAD_SHA}\n`, stderr: '', exitCode: 0, durationMs: 1 }
      if (command === 'git' && args[0] === 'show')
        return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
      if (command === process.execPath) {
        const stdout = parserResult()
        return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
      }
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
    })
    expect(() =>
      runShipCrossModelReview({
        dir: '/tmp/project',
        taskId: '#2747',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
        cfg,
        ...FROZEN_REVIEW,
      }),
    ).toThrow(/frozen plan|acceptance criteria/i)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('records a consent degradation without collecting or sending a diff', () => {
    mockFrozenShipCalls()
    const noConsent = { ...cfg, diffEgressConsent: false }
    runShipCrossModelReview({
      dir: '/tmp/project',
      taskId: '#2357',
      tier: 'Standard',
      phase: 'refactor',
      vertical: 'security',
      cfg: noConsent,
      ...FROZEN_REVIEW,
    })

    expect(
      mockedRunCli.mock.calls.some(([command, args]) => command === 'git' && args[0] === 'diff'),
    ).toBe(false)
    expect(mockedInvoke).toHaveBeenCalledWith(expect.objectContaining({ diff: '', cfg: noConsent }))
    expect(mockedInvoke.mock.calls[0]?.[0]).not.toHaveProperty('access')
  })

  it('writes a fresh sidecar and replaces the current panel tail with Codex', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-sidecar-'))
    try {
      runCrossModelReview({
        dir,
        taskId: '#2357',
        prompt: 'Review.',
        diff: 'diff',
      })
      const sidecarPath = join(dir, '.arbiter', 'agents-dispatched.json')
      expect(JSON.parse(readFileSync(sidecarPath, 'utf8'))).toEqual({
        count: 2,
        agents: ['anthropic-reviewer', 'codex-reviewer'],
        expectedProvenance: {
          'codex-reviewer': { vendor: 'openai', dispatch: 'external-cli', cli: 'codex' },
        },
        taskId: '#2357',
        branch: 'diff',
        sha: 'diff',
      })

      writeFileSync(
        sidecarPath,
        JSON.stringify({
          count: 1,
          agents: ['codex-reviewer'],
          taskId: '#2357',
          branch: 'diff',
          sha: 'diff',
        }),
      )
      runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' })
      expect(JSON.parse(readFileSync(sidecarPath, 'utf8'))).toMatchObject({
        count: 2,
        agents: ['anthropic-reviewer', 'codex-reviewer'],
      })

      writeFileSync(sidecarPath, JSON.stringify({ taskId: '#2357', branch: 'diff', sha: 'diff' }))
      runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' })
      expect(JSON.parse(readFileSync(sidecarPath, 'utf8'))).toMatchObject({
        count: 2,
        agents: ['anthropic-reviewer', 'codex-reviewer'],
      })

      writeFileSync(
        sidecarPath,
        JSON.stringify({ count: 0, agents: [], taskId: '#2357', branch: 'diff', sha: 'diff' }),
      )
      runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' })
      expect(JSON.parse(readFileSync(sidecarPath, 'utf8'))).toMatchObject({
        count: 2,
        agents: ['anthropic-reviewer', 'codex-reviewer'],
      })

      writeFileSync(
        sidecarPath,
        JSON.stringify({
          count: 2,
          agents: ['anthropic-reviewer', 'anthropic-reviewer-2'],
          taskId: '#2357',
          branch: 'diff',
          sha: 'diff',
        }),
      )
      runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' })
      expect(JSON.parse(readFileSync(sidecarPath, 'utf8')).agents).toEqual([
        'anthropic-reviewer',
        'codex-reviewer',
      ])

      writeFileSync(
        sidecarPath,
        JSON.stringify({
          count: 3,
          agents: ['security-review', 'data-integrity-review', 'silent-failures-review'],
          taskId: '#2357',
          branch: 'diff',
          sha: 'diff',
        }),
      )
      runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' })
      expect(JSON.parse(readFileSync(sidecarPath, 'utf8'))).toMatchObject({
        count: 3,
        agents: ['security-review', 'data-integrity-review', 'codex-reviewer'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('materializes the configured three-seat specialist panel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-treatment-sidecar-'))
    try {
      mockFrozenShipCalls()
      runShipCrossModelReview({
        dir,
        taskId: '#2747',
        tier: 'Critical',
        phase: 'refactor',
        vertical: 'security',
        cfg,
        access: mockedDetect.mock.results[0]?.value,
        ...FROZEN_REVIEW,
        treatment: {
          finalReviewers: 3,
          reviewerVerticals: ['security', 'data-integrity', 'bugs'],
          signalsHash: 'treatment-hash',
        },
      })

      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toMatchObject({
        count: 3,
        agents: ['anthropic-reviewer', 'anthropic-reviewer-2', 'codex-reviewer'],
        auditors: ['security', 'data-integrity', 'bugs'],
        treatmentHash: 'treatment-hash',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    ['non-object JSON', []],
    ['non-array agents', { count: 1, agents: 'codex-reviewer' }],
    ['non-string agent', { count: 1, agents: [1] }],
    ['duplicate agents', { count: 2, agents: ['codex-reviewer', 'codex-reviewer'] }],
    ['non-numeric count', { count: '1', agents: ['codex-reviewer'] }],
    ['fractional count', { count: 0.5, agents: ['codex-reviewer'] }],
    ['negative count', { count: -1, agents: ['codex-reviewer'] }],
    ['count above panel size', { count: 2, agents: ['codex-reviewer'] }],
  ])('rejects a malformed existing sidecar: %s', (_label, malformed) => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-invalid-sidecar-'))
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(
        join(dir, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify(
          Array.isArray(malformed)
            ? malformed
            : { taskId: '#2357', branch: 'diff', sha: 'diff', ...malformed },
        ),
      )
      expect(() =>
        runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' }),
      ).toThrow(/JSON object|invalid agent|duplicate agent|invalid count/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked sidecar before the write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-sidecar-link-'))
    const outside = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-sidecar-outside-'))
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      symlinkSync(
        join(outside, 'agents-dispatched.json'),
        join(dir, '.arbiter', 'agents-dispatched.json'),
      )
      expect(() =>
        runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' }),
      ).toThrow(/symbolic|symlink/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects a sidecar path that is not a regular file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-sidecar-directory-'))
    try {
      mkdirSync(join(dir, '.arbiter', 'agents-dispatched.json'), { recursive: true })
      expect(() =>
        runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' }),
      ).toThrow(/regular file/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('degrades the ship bridge when diff collection fails and still records the panel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-diff-failure-'))
    try {
      mockedRunCli.mockReset()
      mockedRunCli.mockImplementation((command, args) => {
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD')
          return { stdout: `${HEAD_SHA}\n`, stderr: '', exitCode: 0, durationMs: 1 }
        if (command === 'git' && args[0] === 'show')
          return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
        if (command === process.execPath)
          return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
        if (command === 'git' && args[0] === 'status')
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
        if (command === 'git' && args[0] === 'diff') {
          throw new Error('git diff failed')
        }
        return { stdout: 'diff-state', stderr: '', exitCode: 0, durationMs: 1 }
      })

      const result = runShipCrossModelReview({
        dir,
        taskId: '#2357',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
        cfg,
        access: mockedDetect.mock.results[0]?.value,
        ...FROZEN_REVIEW,
      })

      expect(result.status).toBe('fulfilled')
      expect(mockedInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          diff: '',
          cfg,
          preflightDegradation: 'invocation-failed',
          preflightError: expect.objectContaining({ message: 'git diff failed' }),
        }),
      )
      expect(mockedInvoke.mock.calls.at(-1)?.[0]).not.toHaveProperty('access')
      expect(existsSync(join(dir, '.arbiter', 'agents-dispatched.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not trust a matching sidecar without valid fulfilled dispatch evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-cache-check-'))
    try {
      writeFileSync(join(dir, 'tracked.txt'), 'fixture\n')
      execFileSync('git', ['init', '-q', '-b', 'task/#2357-cache-check'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 'test-user'], { cwd: dir })
      execFileSync('git', ['add', 'tracked.txt'], { cwd: dir })
      execFileSync('git', ['commit', '-q', '-m', 'fixture', '--no-gpg-sign'], { cwd: dir })
      const branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim()
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim()
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(
        join(dir, '.arbiter', 'agents-dispatched.json'),
        `${JSON.stringify({
          count: 1,
          agents: ['codex-reviewer'],
          expectedProvenance: {
            'codex-reviewer': { vendor: 'openai', dispatch: 'external-cli', cli: 'codex' },
          },
          taskId: '#2357',
          branch,
          sha,
        })}\n`,
      )

      mockedRunCli.mockImplementation((command, args) => {
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: `${branch}\n`, stderr: '', exitCode: 0, durationMs: 1 }
        }
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { stdout: `${sha}\n`, stderr: '', exitCode: 0, durationMs: 1 }
        }
        if (command === 'node' && args[0]?.endsWith('scripts/check-cross-model-review.mjs')) {
          return { stdout: '', stderr: 'invalid evidence', exitCode: 1, durationMs: 1 }
        }
        if (command === 'git' && args[0] === 'status') {
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
        }
        if (command === 'git' && args[0] === 'show')
          return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
        if (command === process.execPath)
          return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
        return { stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 }
      })

      runShipCrossModelReview({
        dir,
        taskId: '#2357',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
        cfg,
        access: mockedDetect.mock.results[0]?.value,
        ...FROZEN_REVIEW,
        headSha: sha,
      })

      expect(mockedInvoke).toHaveBeenCalledTimes(1)
      expect(mockedRunCli).toHaveBeenCalledWith(
        'node',
        [expect.stringContaining('scripts/check-cross-model-review.mjs'), '--require-fulfilled'],
        expect.objectContaining({ cwd: dir, retries: 0 }),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not reuse fulfilled cache evidence when the tree is dirty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dirty-cache-'))
    try {
      const branch = 'task/#2357-dirty-cache'
      const sha = 'a'.repeat(40)
      mkdirSync(join(dir, '.git'))
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(
        join(dir, '.arbiter', 'agents-dispatched.json'),
        `${JSON.stringify({
          count: 1,
          agents: ['codex-reviewer'],
          expectedProvenance: {
            'codex-reviewer': { vendor: 'openai', dispatch: 'external-cli', cli: 'codex' },
          },
          taskId: '#2357',
          branch,
          sha,
        })}\n`,
      )
      mockedRunCli.mockImplementation((command, args) => {
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: `${branch}\n`, stderr: '', exitCode: 0, durationMs: 1 }
        }
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { stdout: `${sha}\n`, stderr: '', exitCode: 0, durationMs: 1 }
        }
        if (command === 'git' && args[0] === 'status') {
          return { stdout: ' M tracked.txt\n', stderr: '', exitCode: 0, durationMs: 1 }
        }
        if (command === 'node' && args[0]?.endsWith('scripts/check-cross-model-review.mjs')) {
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
        }
        if (command === 'git' && args[0] === 'show')
          return { stdout: FROZEN_PLAN, stderr: '', exitCode: 0, durationMs: 1 }
        if (command === process.execPath)
          return { stdout: FROZEN_BRIEF_JSON, stderr: '', exitCode: 0, durationMs: 1 }
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
      })

      runShipCrossModelReview({
        dir,
        taskId: '#2357',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
        cfg,
        access: mockedDetect.mock.results[0]?.value,
        ...FROZEN_REVIEW,
        headSha: sha,
      })

      expect(mockedInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          diff: '',
          preflightDegradation: 'invocation-failed',
          preflightError: expect.objectContaining({
            message: expect.stringContaining('uncommitted'),
          }),
        }),
      )
      expect(
        mockedRunCli.mock.calls.some(
          ([command, args]) =>
            command === 'node' && args[0]?.endsWith('scripts/check-cross-model-review.mjs'),
        ),
      ).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not create a sidecar for a non-fulfilled result', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-no-sidecar-'))
    try {
      mockedInvoke.mockReturnValueOnce({
        provider: 'codex',
        status: 'degraded',
        diffBytes: 0,
        diffTruncated: false,
        degradationReasons: ['provider-unavailable'],
        recorded: false,
      })
      runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' })
      expect(existsSync(join(dir, '.arbiter', 'agents-dispatched.json'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('arbiter ship cross-model wiring (#2357)', () => {
  it('invokes the external seat from the real CLI refactor boundary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-ship-cross-model-'))
    try {
      const bin = join(dir, 'bin')
      mkdirSync(bin, { recursive: true })
      const codex = join(bin, 'codex')
      writeFileSync(
        codex,
        '#!/bin/sh\n' +
          'if [ "$1" = "--version" ]; then printf "codex 1.2.3\\n"; exit 0; fi\n' +
          // #2431: consume the prompt; otherwise the seat write can race child exit with EPIPE.
          'cat > "$(dirname "$0")/../codex-stdin.txt"\n' +
          'out=""\n' +
          'while [ "$#" -gt 0 ]; do\n' +
          '  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi\n' +
          'done\n' +
          'count_file="$(dirname "$0")/../codex-count"\n' +
          'count=0\n' +
          'if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi\n' +
          'printf "%s" "$((count + 1))" > "$count_file"\n' +
          'printf \'{"verdict":"PASS","confidence":1,"findings":[],"refutations":[]}\\n\' > "$out"\n',
      )
      chmodSync(codex, 0o755)
      mkdirSync(join(dir, '.codex'), { recursive: true })
      writeFileSync(join(dir, '.codex', 'auth.json'), '{}\n')

      const sourceConfig = JSON.parse(
        readFileSync(join(REPO_ROOT, 'arbiter.json'), 'utf8'),
      ) as Record<string, unknown>
      sourceConfig.collaborationMode = 'peer-review'
      sourceConfig.crossModelReview = {
        enabled: true,
        diffEgressConsent: true,
        providers: ['codex'],
        slots: { codeReview: 1, redTeamReview: 0 },
        // #2501: this case proves the external seat is INVOKED from the real CLI boundary; it is
        // not a test of the timeout. A 5s budget made it race a wall clock, so on a loaded machine
        // the stub missed the deadline, the seat degraded, and `findings` came back empty — a red
        // that says nothing about the wiring under test.
        //
        // 20s was the first correction, 90s the second, and BOTH were the wrong shape of fix. The
        // defect is not that the number was too small — it is that this test had TWO clocks racing
        // each other: an inner per-invocation budget and the outer spawnSync timeout below. Under
        // load the inner one won, the stub was SIGTERMed, and the artifact came back
        // `{fulfilled: 0, degraded: [{reason: "nonzero-exit", detail: "Codex exited with status
        // -1"}]}` — status -1 being spawnSync's report of a signal kill, not a stub that exited
        // badly. The same file passes 15/15 in 2s in isolation every time.
        //
        // So the inner clock is removed from contention rather than retuned: at 300s (which is
        // simply the config default, not a magic number) it can never fire before the outer 120s,
        // leaving exactly ONE timeout able to fail this case — the outer one, which is there to
        // catch a genuine hang. A test whose verdict depends on which of two deadlines expires
        // first is a test of the machine's load, and this case is a test of whether the external
        // seat is REACHED from the CLI boundary.
        timeoutMs: 300_000,
        onUnavailable: 'degrade',
      }
      writeFileSync(join(dir, 'arbiter.json'), `${JSON.stringify(sourceConfig, null, 2)}\n`)
      writeFileSync(
        join(dir, 'package.json'),
        '{"name":"cross-model-cli-fixture","version":"1.0.0"}\n',
      )

      const statusDir = join(dir, '.claude', '.task')
      mkdirSync(statusDir, { recursive: true })
      writeFileSync(
        join(statusDir, 'status.json'),
        `${JSON.stringify(
          {
            taskId: '#2357',
            phase: 'refactor',
            tier: 'Standard',
            plan: 'plan.md',
            branch: '',
            cursor: { tddPhase: null, lastAction: '', nextAction: '' },
            handoffStrategy: null,
            handoffReady: false,
            runId: 'cross-model-cli-test',
            timestamps: {},
            gateDecisions: [],
          },
          null,
          2,
        )}\n`,
      )
      writeFileSync(
        join(dir, '.gitignore'),
        '.claude/.task/\n.evidence/\n.local/\ncodex-count\ncodex-stdin.txt\n',
      )
      writeFileSync(
        join(dir, 'plan.md'),
        '# Review fixture\n\n## Acceptance Criteria\n- [ ] AC-2357.1: Reach  the `external` review seat.\n\n## Non-Goals\n- Do  not rewrite `dispatch`.\n',
      )

      mkdirSync(join(dir, 'schemas'), { recursive: true })
      mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
      for (const relativePath of [
        'schemas/agent-return.schema.json',
        'schemas/agent-return-external.schema.json',
        'schemas/cross-model-dispatch.schema.json',
        'scripts/check-cross-model-review.mjs',
        'scripts/record-agent-return.mjs',
        'scripts/lib/acceptance-criteria.mjs',
        'scripts/lib/agent-return-validate.mjs',
        'scripts/lib/run-helpers.mjs',
        'scripts/lib/evidence-binding.mjs',
        'scripts/lib/gate-args.mjs',
      ]) {
        copyFileSync(join(REPO_ROOT, relativePath), join(dir, relativePath))
      }

      // #2724: this fixture sets HOME to `dir`, so home-side artifacts the CLI writes
      // (`.evidence/`, `.local/`) land inside the working tree; the stub `codex` on PATH writes
      // `codex-count`/`codex-stdin.txt` into the cwd; and the runtime dispatch evidence below is
      // written after the fixture commit. None of that is candidate content, but any untracked
      // file makes the freeze correctly refuse ("review freeze requires a clean HEAD") and then
      // the post-dispatch guard correctly report "unreviewed changes" — both before the guarantee
      // under test (the external seat is reached from the real CLI boundary) can be observed.
      writeFileSync(
        join(dir, '.gitignore'),
        '.claude/.task/\n.arbiter/\n.evidence/\n.local/\ncodex-count\ncodex-stdin.txt\n',
      )
      execFileSync('git', ['init', '-q', '-b', 'task/#2357-cross-model-cli'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 'test-user'], { cwd: dir })
      execFileSync('git', ['add', '-A'], { cwd: dir })
      execFileSync('git', ['commit', '-q', '-m', 'fixture', '--no-gpg-sign'], { cwd: dir })
      const fixtureSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim()
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(
        join(dir, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({
          count: 2,
          agents: ['anthropic-reviewer', 'anthropic-reviewer-2'],
          taskId: '#2357',
          branch: 'task/#2357-cross-model-cli',
          sha: fixtureSha,
        }),
      )
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', fixtureSha], { cwd: dir })

      const result = spawnSync(
        process.execPath,
        [
          join(REPO_ROOT, 'dist', 'cli.js'),
          'ship',
          '#2357',
          '--tier',
          'Standard',
          '--review-round',
          '--dir',
          dir,
        ],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: dir,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            // #2501: the availability probe is a wall-clock spawn of `codex --version`, and its
            // 5s default is what actually failed under load — not the invocation timeout raised
            // above. This case proves the seat is REACHED from the CLI boundary; it is not a test
            // of how fast a process starts.
            ARBITER_EXTERNAL_PROBE_TIMEOUT_MS: '60000',
          },
          timeout: 120_000,
        },
      )

      expect(result.error, result.error?.message).toBeUndefined()
      expect(result.status, (result.stdout ?? '') + (result.stderr ?? '')).toBe(0)
      const artifact = JSON.parse(
        readFileSync(
          join(dir, '.arbiter', 'evidence', 'cross-model', '_2357', 'dispatch.json'),
          'utf8',
        ),
      ) as { fulfilled: Array<{ envelope: string }>; degraded: unknown[] }
      // Name the degradation when there is one: `expected [] to have a length of 1` sends the
      // next reader hunting through the invoker, and the answer is always in `degraded`.
      expect({ fulfilled: artifact.fulfilled.length, degraded: artifact.degraded }).toEqual({
        fulfilled: 1,
        degraded: [],
      })
      expect(artifact.fulfilled).toHaveLength(1)
      expect(readFileSync(join(dir, 'codex-stdin.txt'), 'utf8')).toContain('--- BEGIN DIFF ---')
      expect(readFileSync(join(dir, 'codex-stdin.txt'), 'utf8')).toContain(
        'AC-2357.1: Reach  the `external` review seat.',
      )
      expect(readFileSync(join(dir, 'codex-stdin.txt'), 'utf8')).toContain(
        '- Do  not rewrite `dispatch`.',
      )
      expect(readFileSync(join(dir, artifact.fulfilled[0]!.envelope), 'utf8')).toContain(
        '"vendor": "openai"',
      )
      const sidecar = JSON.parse(
        readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8'),
      ) as {
        count: number
        agents: string[]
        auditors: string[]
        treatmentHash: string
        branch: string
        sha: string
        taskId: string
      }
      const state = JSON.parse(
        readFileSync(join(dir, '.claude', '.task', 'status.json'), 'utf8'),
      ) as {
        treatment: { finalReviewers: number; reviewerVerticals: string[]; signalsHash: string }
      }
      expect(sidecar).toEqual({
        count: state.treatment.finalReviewers,
        agents: ['codex-reviewer'],
        auditors: state.treatment.reviewerVerticals,
        treatmentHash: state.treatment.signalsHash,
        expectedProvenance: {
          'codex-reviewer': { vendor: 'openai', dispatch: 'external-cli', cli: 'codex' },
        },
        branch: 'task/#2357-cross-model-cli',
        sha: fixtureSha,
        taskId: '#2357',
      })

      const cachedReviewCheck = spawnSync(
        process.execPath,
        [join(dir, 'scripts', 'check-cross-model-review.mjs'), '--require-fulfilled'],
        {
          cwd: dir,
          encoding: 'utf8',
          env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH ?? ''}` },
        },
      )
      expect(
        cachedReviewCheck.status,
        `${cachedReviewCheck.stdout}\n${cachedReviewCheck.stderr}\n` +
          spawnSync('git', ['diff', '--name-only'], { cwd: dir, encoding: 'utf8' }).stdout +
          spawnSync('git', ['diff', '--cached', '--name-only'], {
            cwd: dir,
            encoding: 'utf8',
          }).stdout +
          spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
            cwd: dir,
            encoding: 'utf8',
          }).stdout,
      ).toBe(0)

      const second = spawnSync(
        process.execPath,
        [join(REPO_ROOT, 'dist', 'cli.js'), 'ship', '#2357', '--tier', 'Standard', '--dir', dir],
        {
          cwd: dir,
          env: {
            ...process.env,
            HOME: dir,
            PATH: bin + ':' + (process.env.PATH ?? ''),
          },
          stdio: 'ignore',
          // Backstop against a genuine hang, not part of the assertion under test —
          // matches the `ship` E2E convention used elsewhere (ship-tier.test.ts) rather
          // than the tighter 30s that shared an order of magnitude with the old 5s
          // crossModelReview.timeoutMs and could itself be raced under contention (#2501).
          timeout: 60_000,
        },
      )
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0)
      expect(readFileSync(join(dir, 'codex-count'), 'utf8')).toBe('1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats a sidecar without taskId as stale instead of reusing its panel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-sidecar-task-required-'))
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(
        join(dir, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({
          count: 2,
          agents: ['anthropic-reviewer', 'anthropic-reviewer-2'],
          branch: 'diff',
          sha: 'diff',
        }),
      )

      writeExternalReviewSidecar({
        repoRoot: dir,
        taskId: '#2357',
        result: {
          provider: 'codex',
          status: 'fulfilled',
          diffBytes: 1,
          diffTruncated: false,
          degradationReasons: [],
          recorded: true,
          envelope: { verdict: 'PASS', confidence: 1, findings: [], refutations: [] },
        },
      })

      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toEqual({
        count: 2,
        agents: ['anthropic-reviewer', 'codex-reviewer'],
        expectedProvenance: {
          'codex-reviewer': { vendor: 'openai', dispatch: 'external-cli', cli: 'codex' },
        },
        taskId: '#2357',
        branch: 'diff',
        sha: 'diff',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not grow a trunk-solo Standard sidecar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-sidecar-trunk-solo-'))
    try {
      mockedRunCli.mockReturnValue({ stdout: 'diff', stderr: '', exitCode: 0, durationMs: 1 })
      writeExternalReviewSidecar({
        repoRoot: dir,
        taskId: '#2357',
        result: {
          provider: 'codex',
          status: 'fulfilled',
          diffBytes: 1,
          diffTruncated: false,
          degradationReasons: [],
          recorded: true,
          envelope: { verdict: 'PASS', confidence: 1, findings: [], refutations: [] },
        },
        tier: 'Standard',
        collaborationMode: 'trunk-solo',
      })
      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toMatchObject({ count: 1, agents: ['codex-reviewer'] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
