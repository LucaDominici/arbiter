// SPDX-License-Identifier: Apache-2.0
// #2357 — cross-model review slot: pure planning, coercion and recorder boundary.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CROSS_MODEL_REVIEW } from '../../src/config/schema.js'
import type { CrossModelReviewConfig } from '../../src/wizard/types.js'
import type { ExternalModelAccess } from '../../src/detectors/external-model.js'
import { runCli } from '../../src/utils/run-cli.js'
import {
  extractAgentReturnJson,
  invokeExternalReview,
  planCrossModelSlots,
  type ExternalReviewPayload,
} from '../../src/integrations/external-review.js'

vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCli: vi.fn() }
})

const mockedRunCli = vi.mocked(runCli)
const repoRoot = process.cwd()

function config(overrides: Partial<CrossModelReviewConfig> = {}): CrossModelReviewConfig {
  return {
    ...DEFAULT_CROSS_MODEL_REVIEW,
    enabled: true,
    diffEgressConsent: true,
    ...overrides,
    slots: { ...DEFAULT_CROSS_MODEL_REVIEW.slots, ...(overrides.slots ?? {}), codeReview: 1 },
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
})

describe('invokeExternalReview (#2357)', () => {
  beforeEach(() => mockedRunCli.mockReset())

  it('uses read-only Codex stdin and persists only through the recorder (AC-3/AC-4/AC-7)', () => {
    mockedRunCli.mockImplementation((cmd) => {
      if (cmd === 'codex')
        return { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
      return { stdout: '[recorded]', stderr: '', exitCode: 0, durationMs: 1 }
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
        '--skip-git-repo-check',
        '--output-schema',
        join(repoRoot, 'schemas', 'agent-return-external.schema.json'),
        '-o',
        '-C',
        repoRoot,
        '-',
      ]),
      expect.objectContaining({
        cwd: repoRoot,
        input: expect.stringContaining('diff --git a/file b/file'),
        timeoutMs: 12_345,
        retries: 0,
      }),
    )
    const codexArgs = mockedRunCli.mock.calls[0]?.[1] ?? []
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

  it('marks a 512 KiB diff truncation as degradation while keeping the prompt explicit (AC-5)', () => {
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
    expect(result.prompt).toContain('diff-truncated')
    expect(result.prompt).toContain('512 KiB')
  })
})
