import { describe, expect, it } from 'vitest'
import {
  assessGateSpine,
  assessGateSurface,
  parseGateSurfaceOutput,
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
  summarizeRoutingFailures,
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
      existed: true,
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('security')
  })

  it('AC-2 requires byte identity for a customized gate spine', () => {
    const before = "runCheck('project check', 'node', ['custom.mjs'])\n"
    const after = `${before}runCheck('new', 'node', ['new.mjs'])\n`
    const result = assessGateSpine({
      before,
      after,
      recordedRenderHash: 'not-the-disk-hash',
      existed: true,
    })
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
      existed: true,
    })
    expect(result.ok).toBe(true)
  })

  // #2135: the java consumer has no scripts/check-all.mjs, so this branch decided its
  // AC-2 verdict. It used to return `ok: checks.size > 0` — a tautology that reported
  // PASS for a before/after diff the bar never performed.
  it('AC-2 cannot pass when there is no pre-existing gate spine to diff', () => {
    const result = assessGateSpine({
      before: '',
      after: "runCheck('unit', 'npm', ['test'])\nrunCheck('lint', 'eslint', ['.'])\n",
      recordedRenderHash: null,
      existed: false,
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/UNPROVEN/)
  })

  // Fail-closed: a caller that omits `existed` must not inherit a passing baseline.
  it('AC-2 treats a missing `existed` flag as UNPROVEN, never as a pass', () => {
    const source = "runCheck('unit', 'npm', ['test'])\n"
    const result = assessGateSpine({ before: source, after: source, recordedRenderHash: null })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/UNPROVEN/)
  })

  // ── AC-2 (#2135, decided on #2290): emitted-vs-executed reconciliation ─────────
  // The oracle is no longer "did a name disappear between two renders of a file the
  // consumer never runs". It is: every check name a FRESH render emits for this
  // consumer is either mapped to a gate the consumer really executes, declined with a
  // written reason, or carried in a decreasing-ratchet debt register whose issues are
  // machine-verified OPEN. Anything else is unaccounted, and unaccounted is FAIL.
  const surfaceCase = (overrides = {}) => ({
    freshRender: ['unit tests', 'PII scan'],
    declared: ['be-test', 'pii'],
    mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'WIRED:pii' },
    debtRegister: { ceiling: 0, openIssues: [] },
    ...overrides,
  })

  it('AC-2 reconciles a fully wired surface', () => {
    const result = assessGateSurface(surfaceCase())
    expect(result.ok).toBe(true)
  })

  it('AC-2 fails on an emitted name that is neither mapped, declined, nor in debt', () => {
    const result = assessGateSurface(
      surfaceCase({ freshRender: ['unit tests', 'PII scan', 'brand new gate'] }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('brand new gate')
  })

  // Mutation (a): remove an entry from the DECLARED surface. The consumer stopped
  // running a gate, so the emitted name it accounted for is covered by nothing.
  it('AC-2 fails when a mapped gate leaves the executed surface', () => {
    const result = assessGateSurface(surfaceCase({ declared: ['be-test'] }))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('pii')
  })

  // Mutation (b): whitespace-only churn in a spine must NOT redden the row. This is the
  // regression guard for the byte-identity false red the old `customized` branch caused.
  it('AC-2 passes on a whitespace-only change to the executed spine', () => {
    const spine = "runCheck('be-test', 'npm', ['test'])\nrunCheck('pii', 'node', ['pii.mjs'])\n"
    const reformatted = spine.replace(/\n/g, '\n\n').replace(/, /g, ',  ')
    const result = assessGateSurface(
      surfaceCase({ declared: [...extractCheckNames(reformatted)] }),
    )
    expect(result.ok).toBe(true)
  })

  it('AC-2 fails on a mapping entry for a name the render no longer emits', () => {
    const result = assessGateSurface(surfaceCase({ freshRender: ['unit tests'] }))
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/stale/i)
  })

  it('AC-2 refuses a DECLINED entry with no written reason', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'DECLINED:' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/reason/i)
  })

  it('AC-2 accepts a DECLINED entry that carries a reason', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: {
          'unit tests': 'WIRED:be-test',
          'PII scan': 'DECLINED:this consumer stores no personal data',
        },
      }),
    )
    expect(result.ok).toBe(true)
  })

  // Mutation (d): the debt register GROWS. A ratchet that only ever appends is a
  // free-text escape hatch, so cardinality is pinned to a committed integer.
  it('AC-2 fails when the debt register grows past its ceiling', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'DEBT:#2295' },
        debtRegister: { ceiling: 0, openIssues: ['#2295'] },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/ratchet/i)
  })

  // The ratchet bites in BOTH directions: resolving debt forces re-tightening the
  // committed integer, so the slack can never be silently re-spent later.
  it('AC-2 fails when resolved debt leaves the ceiling untightened', () => {
    const result = assessGateSurface(surfaceCase({ debtRegister: { ceiling: 1, openIssues: [] } }))
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/ratchet/i)
  })

  // Mutation (e): a debt entry whose issue is closed or was never real. Without this,
  // `DEBT:#9999` zeroes the criterion — the same disease one floor up.
  it('AC-2 fails on a debt entry whose issue is not verified OPEN', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'DEBT:#9999' },
        debtRegister: { ceiling: 1, openIssues: ['#2295'] },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('#9999')
  })

  it('AC-2 rejects a mapping verdict outside WIRED / DECLINED / DEBT', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'SKIP' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/SKIP/)
  })

  // Mutation (c): failing to OBTAIN the executed surface is an ERROR, never a FAIL and
  // never a PASS. A contended mutex and a genuinely missing gate must not look alike.
  it('AC-2 reports a non-zero dry-run as an acquisition error, never a verdict', () => {
    const parsed = parseGateSurfaceOutput({
      result: { ok: false, status: 1, signal: null, stdout: '', stderr: 'boom' },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.detail).toMatch(/could not be obtained/i)
  })

  it('AC-2 reports a dry-run without a GATES line as an acquisition error', () => {
    const parsed = parseGateSurfaceOutput({
      result: { ok: true, status: 0, signal: null, stdout: 'nothing to see\n', stderr: '' },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.detail).toMatch(/could not be obtained/i)
  })

  it('AC-2 names mutex contention distinctly so it never reads as a missing gate', () => {
    const parsed = parseGateSurfaceOutput({
      result: {
        ok: false,
        status: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: 'gate-exec: mutex /run/user/1000/arbiter/viafera-ci-gate.lock (blocking until free)',
      },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
      contentionMarker: 'viafera-ci-gate.lock',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.detail).toMatch(/contention/i)
  })

  it('AC-2 unions the gate ids of every surface command', () => {
    const parsed = parseGateSurfaceOutput({
      result: {
        ok: true,
        status: 0,
        signal: null,
        stdout: 'noise\n[DRY-RUN] GATES: a,b\n',
        stderr: '',
      },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.gates).toEqual(['a', 'b'])
  })

  it('AC-3 counts only exit 2 as BLOCKS', () => {
    expect(
      classifyHookResult({ exitCode: 2, hardness: 'HARD', applicable: true, rationale: '' }),
    ).toBe('BLOCKS')
    expect(
      classifyHookResult({ exitCode: 1, hardness: 'HARD', applicable: true, rationale: '' }),
    ).toBe('INERT')
  })

  it('AC-3 classifies missing and signalled HARD hook executions as operational errors', () => {
    expect(
      classifyHookResult({
        exitCode: null,
        signal: null,
        hardness: 'HARD',
        applicable: true,
        rationale: '',
      }),
    ).toBe('PROBE-ERROR')
    expect(
      classifyHookResult({
        exitCode: null,
        signal: 'SIGTERM',
        hardness: 'HARD',
        applicable: true,
        rationale: '',
      }),
    ).toBe('PROBE-ERROR')
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

  it('AC-5 keeps stable routing findings while discarding arbitrary child output', () => {
    const summary = summarizeRoutingFailures(
      [
        '[hook-routing] DEAD Arbiter-owned hook owned.mjs',
        '[hook-routing] UNROUTED event PreToolUse:Bash',
        'private child output must not survive',
      ].join('\n'),
    )
    expect(summary).toBe('DEAD Arbiter-owned hook owned.mjs, UNROUTED event PreToolUse:Bash')
    expect(summary).not.toContain('private child output')
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
