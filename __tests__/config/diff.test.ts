import { describe, it, expect } from 'vitest'
import { diffConfig, impactedGenerators } from '../../src/config/diff.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import type { ArbiterConfigV2 } from '../../src/config/schema.js'

function baseV2(overrides: Partial<ArbiterConfigV2> = {}): ArbiterConfigV2 {
  return {
    version: '0.2',
    tools: ['claude', 'codex'],
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
    ...overrides,
  }
}

describe('diffConfig', () => {
  it('returns empty paths when configs are identical', () => {
    const a = baseV2()
    const b = baseV2()
    expect(diffConfig(a, b).paths).toHaveLength(0)
  })

  it('detects top-level field change', () => {
    const a = baseV2()
    const b = baseV2({ useGitHub: true })
    const diff = diffConfig(a, b)
    expect(diff.paths).toContain('useGitHub')
  })

  it('detects nested feature flag change as dotted path', () => {
    const a = baseV2()
    const b = baseV2({ features: { ...a.features, debtGates: false } })
    const diff = diffConfig(a, b)
    expect(diff.paths).toContain('features.debtGates')
    expect(diff.paths).not.toContain('features.mutationTesting')
  })

  it('detects nested threshold change as dotted path', () => {
    const a = baseV2()
    const b = baseV2({ thresholds: { ...a.thresholds, lineCoverage: 90 } })
    const diff = diffConfig(a, b)
    expect(diff.paths).toContain('thresholds.lineCoverage')
    expect(diff.paths).not.toContain('thresholds.branchCoverage')
  })

  it('detects tools array change', () => {
    const a = baseV2({ tools: ['claude', 'codex'] })
    const b = baseV2({ tools: ['claude'] })
    const diff = diffConfig(a, b)
    expect(diff.paths).toContain('tools')
  })
})

describe('impactedGenerators — full regen triggers', () => {
  it('governanceLevel change → *', () => {
    const diff = diffConfig(baseV2(), baseV2({ governanceLevel: 'L3' }))
    const keys = impactedGenerators(diff)
    expect(keys.has('*')).toBe(true)
  })

  it('archetype change → *', () => {
    const diff = diffConfig(baseV2({ archetype: 'library' }), baseV2({ archetype: 'cli' }))
    const keys = impactedGenerators(diff)
    expect(keys.has('*')).toBe(true)
  })

  it('architectureStyle change → *', () => {
    const diff = diffConfig(
      baseV2({ architectureStyle: 'none' }),
      baseV2({ architectureStyle: 'hexagonal' }),
    )
    expect(impactedGenerators(diff).has('*')).toBe(true)
  })

  it('isMultiTenant change → *', () => {
    const diff = diffConfig(baseV2({ isMultiTenant: false }), baseV2({ isMultiTenant: true }))
    expect(impactedGenerators(diff).has('*')).toBe(true)
  })

  it('hasDatabase change → *', () => {
    const diff = diffConfig(baseV2({ hasDatabase: false }), baseV2({ hasDatabase: true }))
    expect(impactedGenerators(diff).has('*')).toBe(true)
  })

  it('hasPublicApi change → *', () => {
    const diff = diffConfig(baseV2({ hasPublicApi: false }), baseV2({ hasPublicApi: true }))
    expect(impactedGenerators(diff).has('*')).toBe(true)
  })

  it('contractType change → *', () => {
    const diff = diffConfig(baseV2({ contractType: 'none' }), baseV2({ contractType: 'grpc' }))
    expect(impactedGenerators(diff).has('*')).toBe(true)
  })
})

describe('impactedGenerators — scoped regen', () => {
  it('tools change → tool-specific generators', () => {
    const diff = diffConfig(baseV2({ tools: ['claude', 'codex'] }), baseV2({ tools: ['claude'] }))
    const keys = impactedGenerators(diff)
    expect(keys.has('*')).toBe(false)
    expect(keys.has('claude')).toBe(true)
    expect(keys.has('codex')).toBe(true)
    expect(keys.has('skills')).toBe(true)
    expect(keys.has('agents-claude')).toBe(true)
    expect(keys.has('agents-md')).toBe(true)
  })

  it('useGitHub change → github + root + check-all', () => {
    const diff = diffConfig(baseV2(), baseV2({ useGitHub: true }))
    const keys = impactedGenerators(diff)
    expect(keys.has('*')).toBe(false)
    expect(keys.has('github')).toBe(true)
    expect(keys.has('root')).toBe(true)
    expect(keys.has('check-all')).toBe(true)
  })

  it('features.debtGates → debt-gates + debt-ratchet + coverage + stride-enforcement', () => {
    const a = baseV2()
    const b = baseV2({ features: { ...a.features, debtGates: false } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(false)
    expect(keys.has('debt-gates')).toBe(true)
    expect(keys.has('debt-ratchet')).toBe(true)
    expect(keys.has('coverage')).toBe(true)
    expect(keys.has('stride-enforcement')).toBe(true)
  })

  it('features.securityScanning → security only', () => {
    const a = baseV2()
    const b = baseV2({ features: { ...a.features, securityScanning: false } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('security')).toBe(true)
    expect(keys.has('debt-gates')).toBe(false)
  })

  it('features.mutationTesting → mutation + check-all + nightly', () => {
    const a = baseV2()
    const b = baseV2({ features: { ...a.features, mutationTesting: false } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('mutation')).toBe(true)
    expect(keys.has('check-all')).toBe(true)
    expect(keys.has('nightly')).toBe(true)
  })

  it('features.contractTesting → contract-testing + integration-testing + github', () => {
    const a = baseV2()
    const b = baseV2({ features: { ...a.features, contractTesting: true } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('contract-testing')).toBe(true)
    expect(keys.has('integration-testing')).toBe(true)
    expect(keys.has('github')).toBe(true)
  })

  it('features.evidenceHarness → evidence-retention + nightly', () => {
    const a = baseV2()
    const b = baseV2({ features: { ...a.features, evidenceHarness: true } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('evidence-retention')).toBe(true)
    expect(keys.has('nightly')).toBe(true)
  })

  it('features.suppressions → suppressions only', () => {
    const a = baseV2()
    const b = baseV2({ features: { ...a.features, suppressions: false } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('suppressions')).toBe(true)
    expect(keys.has('debt-gates')).toBe(false)
  })

  it('thresholds.lineCoverage → check-all + coverage', () => {
    const a = baseV2()
    const b = baseV2({ thresholds: { ...a.thresholds, lineCoverage: 90 } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('check-all')).toBe(true)
    expect(keys.has('coverage')).toBe(true)
    expect(keys.has('mutation')).toBe(false)
  })

  it('thresholds.branchCoverage → check-all + coverage', () => {
    const a = baseV2()
    const b = baseV2({ thresholds: { ...a.thresholds, branchCoverage: 80 } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('check-all')).toBe(true)
    expect(keys.has('coverage')).toBe(true)
  })

  it('thresholds.mutationScore → mutation + check-all', () => {
    const a = baseV2()
    const b = baseV2({ thresholds: { ...a.thresholds, mutationScore: 90 } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('mutation')).toBe(true)
    expect(keys.has('check-all')).toBe(true)
    expect(keys.has('coverage')).toBe(false)
  })

  it('thresholds.cyclomaticComplexity → debt-gates', () => {
    const a = baseV2()
    const b = baseV2({
      thresholds: { ...a.thresholds, cyclomaticComplexity: 10 },
    })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('debt-gates')).toBe(true)
    expect(keys.has('check-all')).toBe(false)
  })

  it('thresholds.methodLength → debt-gates', () => {
    const a = baseV2()
    const b = baseV2({ thresholds: { ...a.thresholds, methodLength: 50 } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('debt-gates')).toBe(true)
  })

  it('thresholds.maxParams → debt-gates', () => {
    const a = baseV2()
    const b = baseV2({ thresholds: { ...a.thresholds, maxParams: 5 } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('debt-gates')).toBe(true)
  })

  it('invariantTiers change → global-invariants + agents-md', () => {
    const a = baseV2({ invariantTiers: ['architectural'] })
    const b = baseV2({ invariantTiers: ['architectural', 'security'] })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('global-invariants')).toBe(true)
    expect(keys.has('agents-md')).toBe(true)
  })
})
