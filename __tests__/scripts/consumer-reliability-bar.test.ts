import { describe, expect, it } from 'vitest'
import {
  assessGateSpine,
  assertCredentialFreeEnvironment,
  buildVerifierEnvironment,
  classifyAdvisoryHookResult,
  classifyHookResult,
  classifyUpdateResult,
  commandOutcomeKind,
  extractCheckNames,
  redactSecrets,
  resultExitCode,
  summarizeProbeFailures,
} from '../../scripts/lib/consumer-reliability-bar.mjs'

describe('consumer reliability bar oracles (#2135)', () => {
  it('AC-2 extracts all three gate-runner call families', () => {
    const source = [
      "runCheck('unit tests', 'npm', ['test'])",
      "runWarnCheck('docs', 'node', ['docs.mjs'])",
      "runToolCheck('lint', 'eslint', ['.'])",
    ].join('\n')
    expect([...extractCheckNames(source)]).toEqual(['docs', 'lint', 'unit tests'])
  })

  it('AC-2 fails when a pre-existing check disappears', () => {
    const result = assessGateSpine({
      before: "runCheck('unit', 'npm', ['test'])\nrunCheck('security', 'node', ['sec.mjs'])\n",
      after: "runCheck('unit', 'npm', ['test'])\n",
      recordedRenderHash: null,
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('security')
  })

  it('AC-2 requires byte identity for a customized gate spine', () => {
    const before = "runCheck('project check', 'node', ['custom.mjs'])\n"
    const after = `${before}runCheck('new', 'node', ['new.mjs'])\n`
    const result = assessGateSpine({ before, after, recordedRenderHash: 'not-the-disk-hash' })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/byte/i)
  })

  it('AC-2 permits an additive template refresh for a pristine gate spine', async () => {
    const before = "runCheck('unit', 'npm', ['test'])\n"
    const recordedRenderHash = await crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(before))
      .then((bytes) => Buffer.from(bytes).toString('hex'))
    const result = assessGateSpine({
      before,
      after: `${before}runCheck('new', 'node', ['new.mjs'])\n`,
      recordedRenderHash,
    })
    expect(result.ok).toBe(true)
  })

  it('AC-3 counts only exit 2 as BLOCKS', () => {
    expect(
      classifyHookResult({ exitCode: 2, hardness: 'HARD', applicable: true, rationale: '' }),
    ).toBe('BLOCKS')
    expect(
      classifyHookResult({ exitCode: 1, hardness: 'HARD', applicable: true, rationale: '' }),
    ).toBe('INERT')
  })

  it('AC-3 requires adjacent rationale for ADVISORY classifications', () => {
    expect(
      classifyHookResult({
        exitCode: 0,
        hardness: 'ADVISORY',
        applicable: true,
        rationale: '',
      }),
    ).toBe('INVALID-ADVISORY')
    expect(
      classifyHookResult({
        exitCode: 0,
        hardness: 'ADVISORY',
        applicable: true,
        rationale: 'Records diagnostic context and intentionally never blocks.',
      }),
    ).toBe('ADVISORY')
  })

  it('AC-3 treats crashed, missing, and blocking advisory hooks as unhealthy', () => {
    const rationale = 'Diagnostic-only hook.'
    expect(classifyAdvisoryHookResult({ exitCode: 0, signal: null, rationale })).toBe('ADVISORY')
    expect(classifyAdvisoryHookResult({ exitCode: 1, signal: null, rationale })).toBe('PROBE-ERROR')
    expect(classifyAdvisoryHookResult({ exitCode: null, signal: null, rationale })).toBe(
      'PROBE-ERROR',
    )
    expect(classifyAdvisoryHookResult({ exitCode: 0, signal: 'SIGTERM', rationale })).toBe(
      'PROBE-ERROR',
    )
    expect(classifyAdvisoryHookResult({ exitCode: 2, signal: null, rationale })).toBe(
      'UNEXPECTED-BLOCK',
    )
  })

  it('AC-5 refuses verifier processes that still carry private clone credentials', () => {
    expect(() =>
      assertCredentialFreeEnvironment({
        ARBITER_CONSUMER_REPOS_TOKEN: 'secret-canary',
      }),
    ).toThrow(/credential/i)
  })

  it('AC-5 builds a strict verifier environment without runner or cloud credentials', () => {
    const clean = buildVerifierEnvironment({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      AWS_SECRET_ACCESS_KEY: 'secret-canary',
      HTTPS_PROXY: 'https://credential.invalid',
      GITHUB_TOKEN: 'secret-canary',
      ARBITER_CONSUMER_GO_DEPLOY_KEY: 'secret-canary',
    })
    expect(clean.PATH).toBe('/usr/bin')
    expect(clean.HOME).toBe('/tmp/home')
    expect(clean.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(clean).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(clean).not.toHaveProperty('HTTPS_PROXY')
    expect(clean).not.toHaveProperty('GITHUB_TOKEN')
    expect(clean).not.toHaveProperty('ARBITER_CONSUMER_GO_DEPLOY_KEY')
  })

  it('AC-5 redacts tokens, private slugs, and URLs from diagnostics', () => {
    const raw = 'clone https://host.invalid/private/repo with secret-canary failed'
    expect(redactSecrets(raw, ['secret-canary', 'private/repo'])).toBe(
      'clone [REDACTED_URL] with [REDACTED] failed',
    )
  })

  it('AC-5 maps regressions to 1 and operational errors to 2', () => {
    expect(resultExitCode([{ kind: 'pass' }])).toBe(0)
    expect(resultExitCode([{ kind: 'fail' }])).toBe(1)
    expect(resultExitCode([{ kind: 'fail' }, { kind: 'error' }])).toBe(2)
    expect(commandOutcomeKind({ status: 1, signal: null })).toBe('fail')
    expect(commandOutcomeKind({ status: 2, signal: null })).toBe('error')
    expect(commandOutcomeKind({ status: null, signal: 'SIGTERM' })).toBe('error')
  })

  it('AC-5 summarizes probe failures without retaining raw hook output', () => {
    const summary = summarizeProbeFailures(
      JSON.stringify({
        failures: [
          {
            hook: 'owned.mjs',
            state: 'PRIMED',
            verdict: 'PROBE-ERROR',
            diagnostic: 'private output must not survive',
          },
        ],
      }),
    )
    expect(summary).toBe('owned.mjs@PRIMED:PROBE-ERROR')
    expect(summary).not.toContain('private output')
  })

  it('AC-1 accepts only Arbiter-declared recoverable update warnings for further inspection', () => {
    const warning = JSON.stringify({
      command: 'update',
      version: '1',
      status: 'warning',
      warnings: ['customized gate spine was withheld'],
      errorClass: 'recoverable',
    })
    expect(classifyUpdateResult({ status: 1, signal: null, stdout: `log\n${warning}\n` })).toEqual({
      acceptable: true,
      status: 'WARN',
      warningCount: 1,
    })
    expect(
      classifyUpdateResult({ status: 1, signal: null, stdout: 'unstructured failure' }),
    ).toEqual({
      acceptable: false,
      status: 'FAIL',
      warningCount: 0,
    })
  })
})
