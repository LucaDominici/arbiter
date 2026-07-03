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

  // #1317 / RT G1a unit 6: a databaseEngine change (none→postgresql) must re-run
  // the integration-testing generator. databaseEngine is an axis field ⇒ '*'
  // (full regen), which necessarily includes integration-testing.
  it('databaseEngine change none→postgresql → * (integration-testing re-run)', () => {
    const diff = diffConfig(
      baseV2({ databaseEngine: 'none' }),
      baseV2({ databaseEngine: 'postgresql' }),
    )
    expect(diff.paths).toContain('databaseEngine')
    const impacted = impactedGenerators(diff)
    expect(impacted.has('*')).toBe(true)
  })

  it('databaseEngine undefined (legacy) does not diff against explicit "none"', () => {
    // FIELD_DEFAULTS normalizes an absent engine to 'none' so a stored legacy
    // config (no engine) doesn't spuriously diff against a none-engine config.
    const diff = diffConfig(baseV2(), baseV2({ databaseEngine: 'none' }))
    expect(diff.paths).not.toContain('databaseEngine')
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

  it('frontend.framework change → frontend-governance (dotted path, not *)', () => {
    const a = baseV2({ frontend: { framework: 'vue' } })
    const b = baseV2({ frontend: { framework: 'react' } })
    const diff = diffConfig(a, b)
    expect(diff.paths).toContain('frontend.framework')
    const keys = impactedGenerators(diff)
    expect(keys.has('*')).toBe(false)
    expect(keys.has('frontend-governance')).toBe(true)
  })

  it('frontend block added wholesale → frontend-governance via bare path', () => {
    const a = baseV2()
    const b = baseV2({ frontend: { framework: 'vue' } })
    const diff = diffConfig(a, b)
    expect(diff.paths).toContain('frontend')
    const keys = impactedGenerators(diff)
    expect(keys.has('*')).toBe(false)
    expect(keys.has('frontend-governance')).toBe(true)
  })

  it('lanes change to include frontend → frontend-governance', () => {
    const a = baseV2({ lanes: ['backend'] })
    const b = baseV2({ lanes: ['backend', 'frontend'] })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('frontend-governance')).toBe(true)
  })

  it('language change → full regen (language is an axis field)', () => {
    const a = baseV2({ language: 'typescript' })
    const b = baseV2({ language: 'python' })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(true)
  })

  // #1654 — newly-mapped generator-driving fields stay scoped (not full regen).
  it('basePackage change → archunit + mutation + modulith (scoped)', () => {
    const a = baseV2({ basePackage: 'com.acme.old' })
    const b = baseV2({ basePackage: 'com.acme.new' })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(false)
    expect(keys.has('archunit')).toBe(true)
    expect(keys.has('mutation')).toBe(true)
    expect(keys.has('modulith')).toBe(true)
  })

  it('strictnessTier change → root + debt-gates + rust-boundaries (scoped)', () => {
    const a = baseV2({ strictnessTier: 'practical' })
    const b = baseV2({ strictnessTier: 'pedantic' })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(false)
    expect(keys.has('root')).toBe(true)
    expect(keys.has('debt-gates')).toBe(true)
    expect(keys.has('rust-boundaries')).toBe(true)
  })

  // #1693: runnerProfile axis (ADR-101) — a cadence-only change re-emits only
  // the github workflows (fuzz+soak move between _nightly/_weekly).
  it('runnerProfile change → github (scoped)', () => {
    const a = baseV2({ runnerProfile: 'fleet' })
    const b = baseV2({ runnerProfile: 'solo' })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(false)
    expect(keys.has('github')).toBe(true)
  })

  it('taxonomy change → test-taxonomy + api-e2e (scoped)', () => {
    const a = baseV2({ taxonomy: { domainDims: ['billing'] } })
    const b = baseV2({ taxonomy: { domainDims: ['billing', 'fraud'] } })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(false)
    expect(keys.has('test-taxonomy')).toBe(true)
    expect(keys.has('api-e2e')).toBe(true)
  })
})

// #1654 — the fail-OPEN hole: a diff touching BOTH a mapped and an unmapped
// generator-driving field previously ran selective regen and silently dropped the
// unmapped field's generators. impactedGenerators must now fail SAFE → full regen.
describe('impactedGenerators — fail-safe on unmapped paths (#1654)', () => {
  it('a single unmapped generator-driving field → full regen', () => {
    const a = baseV2({ thresholdProfile: 'scaled' } as Partial<ArbiterConfigV2>)
    // graceEndsAt is round-tripped but not generator-mapped → must escalate.
    const b = baseV2({ thresholdProfile: 'scaled', graceEndsAt: '2099-01-01T00:00:00Z' })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(true)
  })

  it('mixed mapped + unmapped change escalates to full regen (no silent skip)', () => {
    const a = baseV2()
    const b = baseV2({
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 90 }, // mapped → coverage
      graceEndsAt: '2099-01-01T00:00:00Z', // unmapped → would have been dropped
    })
    const keys = impactedGenerators(diffConfig(a, b))
    expect(keys.has('*')).toBe(true)
  })
})
