import { describe, it, expect } from 'vitest'
import { applyEnvOverrides } from '../../src/config/env-overrides.js'
import type { ArbiterConfigV2 } from '../../src/config/schema.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

function baseConfig(): ArbiterConfigV2 {
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: true,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: { ...DEFAULT_THRESHOLDS.L2 },
  }
}

describe('applyEnvOverrides (#233)', () => {
  it('returns config unchanged when no ARBITER_ env vars are set', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {})
    expect(out.thresholds.lineCoverage).toBe(80)
    expect(out.features.contractTesting).toBe(false)
  })

  it('overrides thresholds via ARBITER_THRESHOLD__<FIELD>', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_THRESHOLD__LINE_COVERAGE: '85',
      ARBITER_THRESHOLD__BRANCH_COVERAGE: '75',
    })
    expect(out.thresholds.lineCoverage).toBe(85)
    expect(out.thresholds.branchCoverage).toBe(75)
    // unmodified field preserved
    expect(out.thresholds.mutationScore).toBe(80)
  })

  it('coerces booleans for ARBITER_FEATURE__<FLAG>', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_FEATURE__CONTRACT_TESTING: 'true',
      ARBITER_FEATURE__MUTATION_TESTING: 'false',
      ARBITER_FEATURE__SECURITY_SCANNING: '1',
      ARBITER_FEATURE__EVIDENCE_HARNESS: '0',
    })
    expect(out.features.contractTesting).toBe(true)
    expect(out.features.mutationTesting).toBe(false)
    expect(out.features.securityScanning).toBe(true)
    expect(out.features.evidenceHarness).toBe(false)
  })

  it('overrides top-level scalar fields via ARBITER_<TOP_FIELD>', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_GOVERNANCE_LEVEL: 'L3',
    })
    expect(out.governanceLevel).toBe('L3')
  })

  it('ignores ARBITER_GOVERNANCE_LEVEL with invalid value', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_GOVERNANCE_LEVEL: 'L99',
    })
    expect(out.governanceLevel).toBe('L2')
  })

  // #1618 Site 1 — bumping the level re-derives auto-derived thresholds so the new
  // level's coverage/complexity bars actually apply (no silent half-upgrade).
  it('re-derives auto-derived thresholds when ARBITER_GOVERNANCE_LEVEL bumps the level', () => {
    const cfg = baseConfig() // thresholds === DEFAULT_THRESHOLDS.L2
    const out = applyEnvOverrides(cfg, { ARBITER_GOVERNANCE_LEVEL: 'L3' })
    expect(out.governanceLevel).toBe('L3')
    expect(out.thresholds.lineCoverage).toBe(DEFAULT_THRESHOLDS.L3.lineCoverage)
    expect(out.thresholds).toEqual(DEFAULT_THRESHOLDS.L3)
  })

  it('keeps custom thresholds on a level bump but warns the half-upgrade is observable', () => {
    const cfg = { ...baseConfig(), thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 73 } }
    const warning = captureStderr(() => {
      const out = applyEnvOverrides(cfg, { ARBITER_GOVERNANCE_LEVEL: 'L3' })
      expect(out.governanceLevel).toBe('L3')
      expect(out.thresholds.lineCoverage).toBe(73) // custom block preserved
    })
    expect(warning).toMatch(/L2→L3/)
  })

  // INV-96 (#1537): a dropped override must keep the no-invalidate semantics (default
  // retained) AND become observable — a silent drop lets an operator believe a gate is
  // tightened when the default is running. Capture stderr to assert the warning.
  function captureStderr(fn: () => void): string {
    let buf = ''
    const orig = process.stderr.write.bind(process.stderr)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stderr.write = ((chunk: any): boolean => {
      buf += String(chunk)
      return true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
    try {
      fn()
    } finally {
      process.stderr.write = orig
    }
    return buf
  }

  it('ignores unknown threshold fields but warns (default retained, not silent)', () => {
    const cfg = baseConfig()
    let out!: ArbiterConfigV2
    const err = captureStderr(() => {
      out = applyEnvOverrides(cfg, { ARBITER_THRESHOLD__BOGUS_FIELD: '100' })
    })
    expect(out.thresholds.lineCoverage).toBe(80)
    expect(err).toMatch(/ARBITER_THRESHOLD__BOGUS_FIELD/)
    expect(err).toMatch(/ignored/i)
  })

  it('ignores unknown feature flags but warns (default retained, not silent)', () => {
    const cfg = baseConfig()
    let out!: ArbiterConfigV2
    const err = captureStderr(() => {
      out = applyEnvOverrides(cfg, { ARBITER_FEATURE__NOT_A_FEATURE: 'true' })
    })
    expect(out.features.contractTesting).toBe(false)
    expect(err).toMatch(/ARBITER_FEATURE__NOT_A_FEATURE/)
    expect(err).toMatch(/ignored/i)
  })

  it('ignores numeric coercion failure but warns (default retained, not silent)', () => {
    const cfg = baseConfig()
    let out!: ArbiterConfigV2
    const err = captureStderr(() => {
      out = applyEnvOverrides(cfg, { ARBITER_THRESHOLD__LINE_COVERAGE: 'abc' })
    })
    expect(out.thresholds.lineCoverage).toBe(80)
    expect(err).toMatch(/ARBITER_THRESHOLD__LINE_COVERAGE/)
    expect(err).toMatch(/not a finite number/i)
  })

  it('does not warn when a valid override is applied', () => {
    const cfg = baseConfig()
    const err = captureStderr(() => {
      applyEnvOverrides(cfg, { ARBITER_THRESHOLD__LINE_COVERAGE: '85' })
    })
    expect(err).toBe('')
  })

  // #1585: an out-of-range coverage override must be DROPPED (default retained) and
  // warned — applying it would flow into validateConfig and brick every command.
  it.each([
    ['ARBITER_THRESHOLD__LINE_COVERAGE', '150'],
    ['ARBITER_THRESHOLD__LINE_COVERAGE', '0'],
    ['ARBITER_THRESHOLD__BRANCH_COVERAGE', '101'],
    ['ARBITER_THRESHOLD__MUTATION_SCORE', '-5'],
  ])('drops out-of-range coverage override %s=%s and warns', (key, raw) => {
    const cfg = baseConfig()
    let out!: ArbiterConfigV2
    const err = captureStderr(() => {
      out = applyEnvOverrides(cfg, { [key]: raw })
    })
    // default L2 thresholds retained, never the out-of-range value
    expect(out.thresholds.lineCoverage).toBe(80)
    expect(out.thresholds.branchCoverage).toBe(70)
    expect(out.thresholds.mutationScore).toBe(80)
    expect(err).toMatch(new RegExp(key))
    expect(err).toMatch(/out of range/i)
  })

  it('drops a zero/negative positive-key override (methodLength=0) and warns', () => {
    const cfg = baseConfig()
    let out!: ArbiterConfigV2
    const err = captureStderr(() => {
      out = applyEnvOverrides(cfg, { ARBITER_THRESHOLD__METHOD_LENGTH: '0' })
    })
    expect(out.thresholds.methodLength).toBe(cfg.thresholds.methodLength)
    expect(err).toMatch(/ARBITER_THRESHOLD__METHOD_LENGTH/)
    expect(err).toMatch(/out of range/i)
  })

  it('keeps the no-invalidate contract: validateConfig stays ok after an out-of-range override', async () => {
    const { validateConfig } = await import('../../src/config/schema.js')
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, { ARBITER_THRESHOLD__LINE_COVERAGE: '150' })
    expect(validateConfig(out).ok).toBe(true)
  })

  it("ignores ARBITER_* env vars that don't match a known pattern", () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_UNRELATED_THING: 'xyz',
      OTHER_VAR: 'ignored',
    })
    expect(out.thresholds.lineCoverage).toBe(80)
  })

  it('does not mutate the input config', () => {
    const cfg = baseConfig()
    const before = JSON.stringify(cfg)
    applyEnvOverrides(cfg, {
      ARBITER_THRESHOLD__LINE_COVERAGE: '95',
    })
    expect(JSON.stringify(cfg)).toBe(before)
  })
})

describe('loadConfig precedence env > file > defaults (#233)', () => {
  it('applies env overrides on top of file values', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-envtest-'))
    try {
      writeFileSync(
        join(dir, 'arbiter.json'),
        JSON.stringify({
          version: '0.2',
          tools: ['claude'],
          governanceLevel: 'L2',
          useGitHub: false,
          features: {
            contractTesting: false,
            mutationTesting: true,
            securityScanning: true,
            evidenceHarness: false,
            debtGates: true,
            suppressions: true,
          },
          thresholds: {
            lineCoverage: 70,
            branchCoverage: 60,
            mutationScore: 80,
            cyclomaticComplexity: 15,
            methodLength: 65,
            maxParams: 7,
          },
        }),
      )

      const orig = process.env['ARBITER_THRESHOLD__LINE_COVERAGE']
      process.env['ARBITER_THRESHOLD__LINE_COVERAGE'] = '90'
      try {
        const { loadConfig } = await import('../../src/utils/config.js')
        const cfg = loadConfig(dir)
        expect(cfg?.thresholds.lineCoverage).toBe(90)
        // File-set value retained when env doesn't override
        expect(cfg?.thresholds.branchCoverage).toBe(60)
      } finally {
        if (orig === undefined) {
          delete process.env['ARBITER_THRESHOLD__LINE_COVERAGE']
        } else {
          process.env['ARBITER_THRESHOLD__LINE_COVERAGE'] = orig
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
