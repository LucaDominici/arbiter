// SPDX-License-Identifier: Apache-2.0
// #2357 — cross-model review slot: pure planning, coercion and recorder boundary.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_CROSS_MODEL_REVIEW } from '../../src/config/schema.js'
import type { CrossModelReviewConfig } from '../../src/wizard/types.js'
import type { ExternalModelAccess } from '../../src/detectors/external-model.js'
import { CliError, runCli } from '../../src/utils/run-cli.js'
import {
  assertSafeArbiterEvidenceRoot,
  extractAgentReturnJson,
  externalSlotsForTier,
  invokeExternalReview,
  planCrossModelSlots,
  type ExternalReviewPayload,
} from '../../src/integrations/external-review.js'

vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCli: vi.fn() }
})
vi.mock('../../src/evidence/git-checks.js', () => ({
  currentBranch: vi.fn(() => 'current-branch'),
  headSha: vi.fn(() => 'current-sha'),
}))

const mockedRunCli = vi.mocked(runCli)
const repoRoot = process.cwd()

function config(overrides: Partial<CrossModelReviewConfig> = {}): CrossModelReviewConfig {
  return {
    ...DEFAULT_CROSS_MODEL_REVIEW,
    enabled: true,
    diffEgressConsent: true,
    ...overrides,
    slots: { ...DEFAULT_CROSS_MODEL_REVIEW.slots, ...(overrides.slots ?? {}) },
  }
}

function access(overrides: Partial<ExternalModelAccess> = {}): ExternalModelAccess {
  return {
    provider: 'codex',
    vendor: 'openai',
    available: true,
    authenticated: true,
    version: '1.2.3',
    error: null,
    ...overrides,
  }
}

const payload: ExternalReviewPayload = {
  verdict: 'PASS',
  confidence: 0.9,
  findings: [],
  refutations: [],
}

describe('planCrossModelSlots (#2357)', () => {
  it('preserves the panel size for every tier and access state (AC-1/AC-2)', () => {
    for (const tier of ['XS', 'S', 'Standard'] as const) {
      for (const providerAccess of [
        access(),
        access({ available: false, authenticated: false, error: 'missing' }),
        access({ available: true, authenticated: false, error: 'unauthenticated' }),
      ]) {
        const plan = planCrossModelSlots({
          tier,
          phase: 'refactor',
          totalSlots: tier === 'Standard' ? 2 : 1,
          verticals: tier === 'Standard' ? ['bugs', 'security'] : ['bugs'],
          cfg: config(),
          access: providerAccess,
        })
        expect(plan.external.length + plan.anthropic.length).toBe(tier === 'Standard' ? 2 : 1)
        if (!providerAccess.available || !providerAccess.authenticated) {
          expect(plan.external).toEqual([])
        }
      }
    }
  })

  it('spends the external seat on security and falls back without consent', () => {
    const planned = planCrossModelSlots({
      tier: 'Standard',
      phase: 'refactor',
      totalSlots: 2,
      verticals: ['bugs', 'security'],
      cfg: config(),
      access: access(),
    })
    expect(planned.external).toEqual(['security'])
    expect(planned.anthropic).toHaveLength(1)

    const fallback = planCrossModelSlots({
      tier: 'Standard',
      phase: 'refactor',
      totalSlots: 2,
      verticals: ['bugs', 'security'],
      cfg: config({ diffEgressConsent: false }),
      access: access(),
    })
    expect(fallback.external).toEqual([])
    expect(fallback.anthropic).toHaveLength(2)
    expect(fallback.degradationReason).toBe('consent-missing')
  })

  it('declares one Standard external slot and none for XS/S (#2358)', () => {
    expect(externalSlotsForTier('XS')).toBe(0)
    expect(externalSlotsForTier('S')).toBe(0)
    expect(externalSlotsForTier('Standard')).toBe(1)
  })

  it('never plans an external seat outside the tier matrix', () => {
    for (const tier of ['XS', 'S'] as const) {
      const plan = planCrossModelSlots({
        tier,
        phase: 'refactor',
        totalSlots: 1,
        verticals: ['bugs'],
        cfg: config(),
        access: access(),
      })
      expect(plan.external).toEqual([])
      expect(plan.anthropic).toEqual(['bugs'])
    }
  })
})

describe('extractAgentReturnJson (#2357)', () => {
  const cases: Array<[string, ExternalReviewPayload | null]> = [
    [JSON.stringify(payload), payload],
    [`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``, payload],
    [`review complete:\n${JSON.stringify(payload)}`, payload],
    [`${JSON.stringify(payload)}\nadditional notes`, payload],
    [`first ${JSON.stringify({ verdict: 'FAIL' })} second ${JSON.stringify(payload)}`, payload],
    [
      `{"verdict":"PASS","confidence":0.9,"findings":[{"claim":"brace } in string"}],"refutations":[]}`,
      {
        verdict: 'PASS',
        confidence: 0.9,
        findings: [{ claim: 'brace } in string' }],
        refutations: [],
      },
    ],
    ['{"verdict":"PASS"', null],
    ['', null],
  ]

  it.each(cases)('coerces %s', (input, expected) => {
    expect(extractAgentReturnJson(input)).toEqual(expected)
  })

  it('rejects authority fields from external output', () => {
    expect(
      extractAgentReturnJson(JSON.stringify({ ...payload, agent: 'attacker', taskId: '#9999' })),
    ).toBeNull()
  })
})

describe('invokeExternalReview (#2357)', () => {
  beforeEach(() => mockedRunCli.mockReset())

  it('rejects a symlinked default evidence root before dispatch', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-symlink-'))
    const outside = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-outside-'))
    try {
      symlinkSync(outside, join(fixture, '.arbiter'), 'dir')
      expect(() =>
        invokeExternalReview({
          repoRoot: fixture,
          taskId: '#2357',
          prompt: 'Review.',
          diff: 'diff',
          cfg: config(),
          access: access(),
        }),
      ).toThrow(/symlink/i)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects a nested symlinked default evidence root before dispatch', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-nested-symlink-'))
    const outside = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-nested-outside-'))
    try {
      mkdirSync(join(fixture, '.arbiter'))
      symlinkSync(outside, join(fixture, '.arbiter', 'evidence'), 'dir')
      mockedRunCli.mockImplementation((cmd) =>
        cmd === 'codex'
          ? { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
          : {
              stdout:
                '[record-agent-return] OK — wrote .arbiter/evidence/agent-returns/_2357/codex-0.json',
              stderr: '',
              exitCode: 0,
              durationMs: 1,
            },
      )
      expect(() =>
        invokeExternalReview({
          repoRoot: fixture,
          taskId: '#2357',
          prompt: 'Review.',
          diff: 'diff',
          cfg: config(),
          access: access(),
        }),
      ).toThrow(/symlink/i)
      expect(existsSync(join(outside, '_2357', 'dispatch.json'))).toBe(false)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('translates a missing repository root error', () => {
    const parent = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-missing-'))
    const missing = join(parent, 'missing')
    try {
      let thrown: unknown
      try {
        assertSafeArbiterEvidenceRoot(missing)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({ name: 'ArbiterError', code: 'ENOENT' })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked custom dispatch root before writing outside it', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-custom-symlink-'))
    const outside = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-custom-outside-'))
    const linkedDispatch = join(fixture, 'dispatch')
    try {
      symlinkSync(outside, linkedDispatch, 'dir')
      expect(() =>
        invokeExternalReview({
          repoRoot,
          taskId: '#2358',
          prompt: 'Review.',
          diff: 'diff',
          cfg: config({ diffEgressConsent: false }),
          evidenceDir: join(fixture, 'agent-returns'),
          dispatchEvidenceDir: linkedDispatch,
          tier: 'Standard',
          phase: 'refactor',
          vertical: 'security',
        }),
      ).toThrow(/symlink|symbolic|ELOOP|descriptor|unsupported/i)
      expect(existsSync(join(outside, '_2358', 'dispatch.json'))).toBe(false)
    } catch (error) {
      expect(String(error)).toMatch(/symlink|symbolic|ELOOP|descriptor|unsupported/i)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects an intermediate symlink in a custom dispatch root before writing outside it', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-custom-nested-symlink-'))
    const outside = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-custom-nested-outside-'))
    const linkedParent = join(fixture, 'linked')
    const linkedDispatch = join(linkedParent, 'dispatch')
    try {
      mkdirSync(join(outside, 'dispatch'))
      symlinkSync(outside, linkedParent, 'dir')
      expect(() =>
        invokeExternalReview({
          repoRoot,
          taskId: '#2358',
          prompt: 'Review.',
          diff: 'diff',
          cfg: config({ diffEgressConsent: false }),
          evidenceDir: join(fixture, 'agent-returns'),
          dispatchEvidenceDir: linkedDispatch,
          tier: 'Standard',
          phase: 'refactor',
          vertical: 'security',
        }),
      ).toThrow(/symlink|symbolic|ELOOP|descriptor|unsupported/i)
      expect(existsSync(join(outside, 'dispatch', '_2358', 'dispatch.json'))).toBe(false)
    } catch (error) {
      expect(String(error)).toMatch(/symlink|symbolic|ELOOP|descriptor|unsupported/i)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('stamps dispatch identity from Git instead of caller-supplied branch and SHA', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-identity-'))
    try {
      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config({ diffEgressConsent: false }),
        evidenceDir: join(evidenceRoot, 'agent-returns'),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })

      expect(result.status).toBe('degraded')
      expect(
        JSON.parse(readFileSync(join(evidenceRoot, '_2358', 'dispatch.json'), 'utf8')),
      ).toMatchObject({
        branch: 'current-branch',
        sha: 'current-sha',
      })
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('uses read-only Codex stdin and persists only through the recorder (AC-3/AC-4/AC-7)', () => {
    mockedRunCli.mockImplementation((cmd) => {
      if (cmd === 'codex')
        return { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
      return {
        stdout: '[record-agent-return] OK — wrote .arbiter/evidence/agent-returns/_2357/codex.json',
        stderr: '',
        exitCode: 0,
        durationMs: 1,
      }
    })

    const result = invokeExternalReview({
      repoRoot,
      taskId: '#2357',
      prompt: 'Review this change.',
      diff: 'diff --git a/file b/file',
      cfg: config({ timeoutMs: 12_345 }),
      access: access(),
    })

    expect(result.status).toBe('fulfilled')
    expect(mockedRunCli).toHaveBeenNthCalledWith(
      1,
      'codex',
      expect.arrayContaining([
        'exec',
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--ignore-user-config',
        '-c',
        'shell_environment_policy.inherit="none"',
        '--skip-git-repo-check',
        '--output-schema',
        join(repoRoot, 'schemas', 'agent-return-external.schema.json'),
        '-o',
        '-',
      ]),
      expect.objectContaining({
        cwd: expect.any(String),
        input: expect.stringContaining('diff --git a/file b/file'),
        timeoutMs: 12_345,
        retries: 0,
      }),
    )
    const codexArgs = mockedRunCli.mock.calls[0]?.[1] ?? []
    const sandboxRoot = codexArgs[codexArgs.indexOf('-C') + 1]
    expect(sandboxRoot).toEqual(expect.any(String))
    expect(sandboxRoot).not.toBe(repoRoot)
    expect(mockedRunCli.mock.calls[0]?.[2]).toMatchObject({ cwd: sandboxRoot })
    expect(codexArgs).not.toContain('Review this change.')
    expect(codexArgs).not.toContain('diff --git a/file b/file')
    expect(mockedRunCli).toHaveBeenNthCalledWith(
      2,
      'node',
      expect.arrayContaining([
        join(repoRoot, 'scripts', 'record-agent-return.mjs'),
        '--task',
        '#2357',
        '--provenance-vendor',
        'openai',
        '--provenance-cli',
        'codex',
        '--provenance-dispatch',
        'external-cli',
      ]),
      expect.objectContaining({ input: expect.not.stringContaining('[recorded]') }),
    )
    expect(
      readFileSync(join(repoRoot, 'schemas', 'agent-return-external.schema.json'), 'utf-8'),
    ).toContain('agent-return-external')
  })

  it('degrades instead of recording external authority fields', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-forged-payload-'))
    try {
      mkdirSync(join(evidenceRoot, '_2357'), { recursive: true })
      mockedRunCli.mockImplementation((cmd) => {
        if (cmd === 'codex') {
          return {
            stdout: JSON.stringify({ ...payload, agent: 'attacker', taskId: '#9999' }),
            stderr: '',
            exitCode: 0,
            durationMs: 1,
          }
        }
        return {
          stdout: '[record-agent-return] OK — wrote forged.json',
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      })

      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2357',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config(),
        access: access(),
        evidenceDir: join(evidenceRoot, 'agent-returns'),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })

      expect(result.status).toBe('degraded')
      expect(result.degradationReason).toBe('coercion-failed')
      expect(mockedRunCli).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('marks a 512 KiB diff truncation as degradation without returning the full prompt (AC-5)', () => {
    mockedRunCli.mockImplementation((cmd) =>
      cmd === 'codex'
        ? { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
        : { stdout: '', stderr: '', exitCode: 0, durationMs: 1 },
    )
    const result = invokeExternalReview({
      repoRoot,
      taskId: '#2357',
      prompt: 'Review.',
      diff: 'x'.repeat(512 * 1024 + 10),
      cfg: config(),
      access: access(),
    })
    expect(result.status).toBe('degraded')
    expect(result.degradationReason).toBe('diff-truncated')
    const codexOptions = mockedRunCli.mock.calls[0]?.[2] as { input?: string } | undefined
    expect(codexOptions?.input).toContain('diff-truncated')
    expect(codexOptions?.input).toContain('512 KiB')
    expect(result).not.toHaveProperty('prompt')
  })

  it('writes dispatch evidence for an enabled degraded run (#2358)', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-'))
    try {
      mockedRunCli.mockImplementation(() => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 1,
      }))
      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config({ diffEgressConsent: false }),
        evidenceDir: join(evidenceRoot, 'agent-returns'),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })

      expect(result.status).toBe('degraded')
      const artifact = join(evidenceRoot, '_2358', 'dispatch.json')
      expect(existsSync(artifact)).toBe(true)
      const dispatch = JSON.parse(readFileSync(artifact, 'utf-8'))
      expect(dispatch).toMatchObject({
        schema: 'arbiter-cross-model-dispatch-v1',
        taskId: '#2358',
        branch: 'current-branch',
        sha: 'current-sha',
        phase: 'refactor',
        requested: [{ provider: 'codex', vertical: 'security' }],
        fulfilled: [],
        degraded: [
          {
            provider: 'codex',
            vertical: 'security',
            substitute: 'anthropic',
            reason: 'consent-absent',
          },
        ],
      })
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('does not manufacture a degraded outcome for tiers without an external seat', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-xs-'))
    try {
      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config(),
        access: access(),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'XS',
        phase: 'refactor',
        vertical: 'bugs',
      })
      expect(result.degradationReasons).toEqual([])
      const dispatch = JSON.parse(
        readFileSync(join(evidenceRoot, '_2358', 'dispatch.json'), 'utf-8'),
      )
      expect(dispatch.requested).toEqual([])
      expect(dispatch.degraded).toEqual([])
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('does not request or degrade when the external code-review slot is zero', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-zero-'))
    try {
      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config({ slots: { codeReview: 0, redTeamReview: 0 } }),
        access: access(),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'bugs',
      })
      expect(result.degradationReasons).toEqual([])
      const dispatch = JSON.parse(
        readFileSync(join(evidenceRoot, '_2358', 'dispatch.json'), 'utf-8'),
      )
      expect(dispatch.requested).toEqual([])
      expect(dispatch.degraded).toEqual([])
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('stops the external review when onUnavailable is fail (#2358)', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-fail-'))
    try {
      expect(() =>
        invokeExternalReview({
          repoRoot,
          taskId: '#2358',
          prompt: 'Review.',
          diff: 'diff',
          cfg: config({ diffEgressConsent: false, onUnavailable: 'fail' }),
          dispatchEvidenceDir: evidenceRoot,
          tier: 'Standard',
          phase: 'refactor',
          vertical: 'security',
        }),
      ).toThrow(/unavailable|degrad/i)
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('stops when the recorder rejects an otherwise valid external envelope', () => {
    mockedRunCli.mockImplementation((cmd) => {
      if (cmd === 'codex')
        return { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
      if (cmd === 'node') throw new Error('recorder rejected envelope')
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
    })

    expect(() =>
      invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config({ onUnavailable: 'fail' }),
        dispatchEvidenceDir: mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-rejected-')),
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      }),
    ).toThrow(/unavailable|envelope-rejected|degrad/i)
  })

  it('degrades when the recorder exits without confirming persistence', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-no-marker-'))
    try {
      mockedRunCli.mockImplementation((cmd) =>
        cmd === 'codex'
          ? { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
          : { stdout: '', stderr: '', exitCode: 0, durationMs: 1 },
      )
      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config(),
        access: access(),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })
      expect(result.status).toBe('degraded')
      expect(result.degradationReason).toBe('envelope-rejected')
      const dispatch = JSON.parse(
        readFileSync(join(evidenceRoot, '_2358', 'dispatch.json'), 'utf-8'),
      )
      expect(dispatch.fulfilled).toEqual([])
      expect(dispatch.degraded[0].reason).toBe('envelope-rejected')
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('preserves provider probe detail in degraded dispatch evidence', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-probe-'))
    try {
      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config(),
        access: access({
          available: false,
          authenticated: false,
          error: 'codex CLI probe timed out',
        }),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })
      expect(result.status).toBe('degraded')
      const dispatch = JSON.parse(
        readFileSync(join(evidenceRoot, '_2358', 'dispatch.json'), 'utf-8'),
      )
      expect(dispatch.degraded[0]).toMatchObject({
        reason: 'timeout',
        detail: 'codex CLI probe timed out',
      })
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('reads the non-empty Codex output file before stdout', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-output-file-'))
    try {
      mockedRunCli.mockImplementation((cmd, args) => {
        if (cmd === 'codex') {
          const outputPath = args[args.indexOf('-o') + 1]
          writeFileSync(outputPath!, JSON.stringify(payload))
          return { stdout: 'ignored stdout', stderr: '', exitCode: 0, durationMs: 1 }
        }
        return {
          stdout: '[record-agent-return] OK — wrote codex.json',
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }
      })

      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2357',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config(),
        access: access(),
        evidenceDir: join(evidenceRoot, 'agent-returns'),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })

      expect(result.status).toBe('fulfilled')
      expect(result.envelope).toEqual(payload)
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('degrades oversized Codex output before JSON coercion', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-large-output-'))
    try {
      mockedRunCli.mockImplementationOnce(() => ({
        stdout: `{${'x'.repeat(512 * 1024)}}`,
        stderr: '',
        exitCode: 0,
        durationMs: 1,
      }))

      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2357',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config(),
        access: access(),
        evidenceDir: join(evidenceRoot, 'returns'),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })

      expect(result.status).toBe('degraded')
      expect(result.degradationReason).toBe('coercion-failed')
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('records typed CLI invocation failures and preserves their dispatch reason', () => {
    const cases = [
      {
        name: 'not-found',
        error: new CliError({
          cmd: 'codex',
          args: ['exec'],
          exitCode: -1,
          stdout: '',
          stderr: '',
          timedOut: false,
          notFound: true,
        }),
        reason: 'cli-not-found',
      },
      {
        name: 'nonzero',
        error: new CliError({
          cmd: 'codex',
          args: ['exec'],
          exitCode: 7,
          stdout: '',
          stderr: 'failed',
          timedOut: false,
          notFound: false,
        }),
        reason: 'nonzero-exit',
      },
      {
        name: 'timeout',
        error: new CliError({
          cmd: 'codex',
          args: ['exec'],
          exitCode: -1,
          stdout: '',
          stderr: 'timed out',
          timedOut: true,
          notFound: false,
        }),
        reason: 'timeout',
      },
    ] as const

    for (const testCase of cases) {
      const evidenceRoot = mkdtempSync(join(tmpdir(), `arbiter-cross-model-${testCase.name}-`))
      try {
        mockedRunCli.mockReset()
        mockedRunCli.mockImplementationOnce(() => {
          throw testCase.error
        })
        let result: ReturnType<typeof invokeExternalReview> | undefined
        let thrown: unknown
        try {
          result = invokeExternalReview({
            repoRoot,
            taskId: '#2358',
            prompt: 'Review.',
            diff: 'diff',
            cfg: config(),
            access: access(),
            evidenceDir: join(evidenceRoot, 'agent-returns'),
            dispatchEvidenceDir: evidenceRoot,
            tier: 'Standard',
            phase: 'refactor',
            vertical: 'security',
          })
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeUndefined()
        const dispatch = JSON.parse(
          readFileSync(join(evidenceRoot, '_2358', 'dispatch.json'), 'utf8'),
        )
        expect(result?.degradationReason).toBe('invocation-failed')
        expect(dispatch.degraded[0]).toMatchObject({ reason: testCase.reason })
      } finally {
        rmSync(evidenceRoot, { recursive: true, force: true })
      }
    }
  })

  it('fails closed when an invocation failure meets the fail policy', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-invocation-fail-'))
    try {
      mockedRunCli.mockImplementationOnce(() => {
        throw new CliError({
          cmd: 'codex',
          args: ['exec'],
          exitCode: 7,
          stdout: '',
          stderr: 'failed',
          timedOut: false,
          notFound: false,
        })
      })
      expect(() =>
        invokeExternalReview({
          repoRoot,
          taskId: '#2358',
          prompt: 'Review.',
          diff: 'diff',
          cfg: config({ onUnavailable: 'fail' }),
          access: access(),
          evidenceDir: join(evidenceRoot, 'agent-returns'),
          dispatchEvidenceDir: evidenceRoot,
          tier: 'Standard',
          phase: 'refactor',
          vertical: 'security',
        }),
      ).toThrow(/unavailable|invocation-failed|degrad/i)
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('maps a provider failure detail without a timeout to a nonzero exit', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-provider-failure-'))
    try {
      const result = invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'diff',
        cfg: config(),
        access: access({ available: false, authenticated: false, error: 'codex CLI failed' }),
        dispatchEvidenceDir: evidenceRoot,
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      })
      const dispatch = JSON.parse(
        readFileSync(join(evidenceRoot, '_2358', 'dispatch.json'), 'utf8'),
      )
      expect(result.status).toBe('degraded')
      expect(dispatch.degraded[0]).toMatchObject({ reason: 'nonzero-exit' })
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true })
    }
  })

  it('stops when a successful external response is degraded by diff truncation', () => {
    mockedRunCli.mockImplementation((cmd) =>
      cmd === 'codex'
        ? { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
        : {
            stdout:
              '[record-agent-return] OK — wrote .arbiter/evidence/agent-returns/_2358/codex.json',
            stderr: '',
            exitCode: 0,
            durationMs: 1,
          },
    )

    expect(() =>
      invokeExternalReview({
        repoRoot,
        taskId: '#2358',
        prompt: 'Review.',
        diff: 'x'.repeat(512 * 1024 + 1),
        cfg: config({ onUnavailable: 'fail' }),
        dispatchEvidenceDir: mkdtempSync(join(tmpdir(), 'arbiter-cross-model-dispatch-truncated-')),
        tier: 'Standard',
        phase: 'refactor',
        vertical: 'security',
      }),
    ).toThrow(/unavailable|diff-truncated|degrad/i)
  })
})
