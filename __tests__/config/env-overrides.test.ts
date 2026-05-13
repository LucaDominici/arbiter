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

  it('ignores unknown thresholds fields silently', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_THRESHOLD__BOGUS_FIELD: '100',
    })
    expect(out.thresholds.lineCoverage).toBe(80)
  })

  it('ignores unknown feature flags silently', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_FEATURE__NOT_A_FEATURE: 'true',
    })
    expect(out.features.contractTesting).toBe(false)
  })

  it('ignores numeric coercion failure', () => {
    const cfg = baseConfig()
    const out = applyEnvOverrides(cfg, {
      ARBITER_THRESHOLD__LINE_COVERAGE: 'abc',
    })
    expect(out.thresholds.lineCoverage).toBe(80)
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
