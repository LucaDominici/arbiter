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
        count: 1,
        agents: ['codex-reviewer'],
        taskId: '#2357',
        branch: 'diff',
        sha: 'diff',
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

  it('rejects an invalid existing sidecar instead of overwriting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-invalid-sidecar-'))
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(
        join(dir, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({
          count: 2,
          agents: ['anthropic-reviewer'],
          taskId: '#2357',
          branch: 'diff',
          sha: 'diff',
        }),
      )
      expect(() =>
        runCrossModelReview({ dir, taskId: '#2357', prompt: 'Review.', diff: 'diff' }),
      ).toThrow(/invalid count/i)
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

  it('degrades the ship bridge when diff collection fails and still records the panel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-diff-failure-'))
    try {
      mockedRunCli.mockReset()
      mockedRunCli
        .mockImplementationOnce(() => {
          throw new Error('git diff failed')
        })
        .mockReturnValue({ stdout: 'diff-state', stderr: '', exitCode: 0, durationMs: 1 })

      runShipCrossModelReview({
        dir,
        taskId: '#2357',
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
        cfg,
        access: mockedDetect.mock.results[0]?.value,
      })

      expect(mockedInvoke).toHaveBeenCalledWith(expect.objectContaining({ diff: '', cfg }))
      expect(mockedInvoke.mock.calls.at(-1)?.[0]).not.toHaveProperty('access')
      expect(existsSync(join(dir, '.arbiter', 'agents-dispatched.json'))).toBe(true)
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
          'out=""\n' +
          'while [ "$#" -gt 0 ]; do\n' +
          '  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi\n' +
          'done\n' +
          'printf \'{"verdict":"PASS","confidence":1,"findings":[],"refutations":[]}\\n\' > "$out"\n',
      )
      chmodSync(codex, 0o755)

      const sourceConfig = JSON.parse(
        readFileSync(join(REPO_ROOT, 'arbiter.json'), 'utf8'),
      ) as Record<string, unknown>
      sourceConfig.collaborationMode = 'peer-review'
      sourceConfig.crossModelReview = {
        enabled: true,
        diffEgressConsent: true,
        providers: ['codex'],
        slots: { codeReview: 1, redTeamReview: 0 },
        timeoutMs: 5_000,
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
            plan: '',
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

      mkdirSync(join(dir, 'schemas'), { recursive: true })
      mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
      for (const relativePath of [
        'schemas/agent-return.schema.json',
        'scripts/record-agent-return.mjs',
        'scripts/lib/agent-return-validate.mjs',
        'scripts/lib/gate-args.mjs',
      ]) {
        copyFileSync(join(REPO_ROOT, relativePath), join(dir, relativePath))
      }

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
        [join(REPO_ROOT, 'dist', 'cli.js'), 'ship', '#2357', '--tier', 'Standard', '--dir', dir],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            OPENAI_API_KEY: 'cross-model-test-sentinel',
          },
          timeout: 30_000,
        },
      )

      expect(result.status).toBe(0)
      const artifact = JSON.parse(
        readFileSync(
          join(dir, '.arbiter', 'evidence', 'cross-model', '_2357', 'dispatch.json'),
          'utf8',
        ),
      ) as { fulfilled: Array<{ envelope: string }>; degraded: unknown[] }
      expect(artifact.fulfilled).toHaveLength(1)
      expect(artifact.degraded).toEqual([])
      expect(readFileSync(join(dir, artifact.fulfilled[0]!.envelope), 'utf8')).toContain(
        '"vendor": "openai"',
      )
      const sidecar = JSON.parse(
        readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8'),
      ) as { count: number; agents: string[]; branch: string; sha: string; taskId: string }
      expect(sidecar).toEqual({
        count: 2,
        agents: ['anthropic-reviewer', 'codex-reviewer'],
        branch: 'task/#2357-cross-model-cli',
        sha: fixtureSha,
        taskId: '#2357',
      })
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

      writeExternalReviewSidecar(dir, '#2357', {
        provider: 'codex',
        status: 'fulfilled',
        diffBytes: 1,
        diffTruncated: false,
        degradationReasons: [],
        recorded: true,
        envelope: { verdict: 'PASS', confidence: 1, findings: [], refutations: [] },
      })

      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toEqual({
        count: 1,
        agents: ['codex-reviewer'],
        taskId: '#2357',
        branch: 'diff',
        sha: 'diff',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
