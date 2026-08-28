import { describe, it, expect } from 'vitest'
import {
  validateConfig,
  DEFAULT_THRESHOLDS,
  AUTH_PROVIDERS,
  OBSERVABILITY_PROVIDERS,
  DEPLOY_TARGETS,
  isDeployTarget,
} from '../../src/config/schema.js'
import { migrateV1ToV2 } from '../../src/config/migrations/v1-to-v2.js'

describe('validateConfig — governanceLevel casing normalization', () => {
  const base = {
    version: '0.2',
    tools: ['claude'],
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
    thresholds: DEFAULT_THRESHOLDS.L2,
  }

  it('normalizes lowercase l2 to L2', () => {
    const result = validateConfig({ ...base, governanceLevel: 'l2' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.governanceLevel).toBe('L2')
  })

  it('normalizes mixed-case L3 variants', () => {
    for (const v of ['l3', 'L3', 'l3']) {
      const result = validateConfig({ ...base, governanceLevel: v })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.config.governanceLevel).toBe('L3')
    }
  })

  it('still rejects genuinely invalid level after normalization', () => {
    const result = validateConfig({ ...base, governanceLevel: 'L5' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('governanceLevel'))).toBe(true)
  })
})

describe('validateConfig — purity (no input mutation, #1530)', () => {
  const base = {
    version: '0.2',
    tools: ['claude'],
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
  }

  it('does not upper-case governanceLevel on the caller object', () => {
    const input = { ...base, governanceLevel: 'l2', thresholds: DEFAULT_THRESHOLDS.L2 }
    const result = validateConfig(input)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.governanceLevel).toBe('L2')
    // The caller's object must be untouched — normalization lives on the returned copy.
    expect(input.governanceLevel).toBe('l2')
  })

  it('does not inject auto-filled thresholds into the caller object', () => {
    const input = { ...base, governanceLevel: 'L2' } as Record<string, unknown>
    const result = validateConfig(input)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.thresholds).toEqual(DEFAULT_THRESHOLDS.L2)
    // The auto-fill must not leak onto the input.
    expect(input['thresholds']).toBeUndefined()
  })

  it('validates a frozen config without throwing', () => {
    const input = Object.freeze({
      ...base,
      governanceLevel: 'l2',
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    expect(() => validateConfig(input)).not.toThrow()
    const result = validateConfig(input)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.governanceLevel).toBe('L2')
  })
})

describe('validateConfig — valid v2', () => {
  it('accepts a well-formed v2 config', () => {
    const config = {
      version: '0.2',
      tools: ['claude', 'codex'],
      governanceLevel: 'L2',
      useGitHub: true,
      features: {
        contractTesting: false,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 70,
        mutationScore: 85,
        cyclomaticComplexity: 15,
        methodLength: 65,
        maxParams: 7,
      },
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.version).toBe('0.2')
      expect(result.config.features.debtGates).toBe(true)
    }
  })

  it('preserves unknown extra fields for forward-compat', () => {
    const config = {
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L1',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L1,
      _experimentalFoo: 'bar',
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.config as Record<string, unknown>)['_experimentalFoo']).toBe('bar')
    }
  })
})

describe('validateConfig — crossModelReview (#2356)', () => {
  const crossModelReview = {
    enabled: true,
    diffEgressConsent: true,
    providers: ['codex'],
    slots: { codeReview: 1, redTeamReview: 0 },
    timeoutMs: 300_000,
    onUnavailable: 'degrade',
  }

  it('accepts the optional cross-model review block without a schema-version bump', () => {
    const result = validateConfig({ ...BASE_VALID, crossModelReview })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.crossModelReview).toEqual(crossModelReview)
      expect(result.config.$schemaVersion).toBeUndefined()
    }
  })

  it('keeps legacy configs without crossModelReview valid', () => {
    const result = validateConfig(BASE_VALID)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.crossModelReview).toBeUndefined()
  })

  it.each([
    ['enabled', { ...crossModelReview, enabled: 'yes' }],
    ['diffEgressConsent', { ...crossModelReview, diffEgressConsent: 'yes' }],
    ['providers', { ...crossModelReview, providers: ['gemini'] }],
    ['slots', { ...crossModelReview, slots: { codeReview: -1, redTeamReview: 0 } }],
    ['timeoutMs', { ...crossModelReview, timeoutMs: 0 }],
    ['onUnavailable', { ...crossModelReview, onUnavailable: 'ignore' }],
  ])('rejects invalid %s values', (_field, value) => {
    const result = validateConfig({ ...BASE_VALID, crossModelReview: value })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((error) => error.includes('crossModelReview'))).toBe(true)
  })
})

describe('validateConfig — companions override map (#1730)', () => {
  const base = {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
    thresholds: DEFAULT_THRESHOLDS.L2,
  }

  it('accepts a well-formed companions map', () => {
    const r = validateConfig({
      ...base,
      companions: { ponytail: { enabled: false, mode: 'lite' } },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects a non-object companions value', () => {
    const r = validateConfig({ ...base, companions: 'not-an-object' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('companions'))).toBe(true)
  })

  it('rejects an array companions value', () => {
    const r = validateConfig({ ...base, companions: ['ponytail'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('companions'))).toBe(true)
  })

  it('rejects mode outside lite|full — ultra can never enter through config', () => {
    const r = validateConfig({ ...base, companions: { ponytail: { mode: 'ultra' } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('companions.ponytail.mode'))).toBe(true)
  })

  it('rejects non-boolean enabled', () => {
    const r = validateConfig({ ...base, companions: { ponytail: { enabled: 'yes' } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('companions.ponytail.enabled'))).toBe(true)
  })
})

describe('validateConfig — rejection', () => {
  it('rejects invalid governanceLevel', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L5',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('governanceLevel'))).toBe(true)
    }
  })

  it('rejects non-string version field', () => {
    const result = validateConfig({
      version: 2,
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('version'))).toBe(true)
    }
  })

  it('rejects lineCoverage below 0', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: -1 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('lineCoverage'))).toBe(true)
    }
  })

  it('rejects lineCoverage equal to 0 (would silently disable coverage gate)', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 0 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('lineCoverage'))).toBe(true)
    }
  })

  it('rejects branchCoverage equal to 0', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: { ...DEFAULT_THRESHOLDS.L2, branchCoverage: 0 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('branchCoverage'))).toBe(true)
    }
  })

  it('rejects mutationScore equal to 0', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: { ...DEFAULT_THRESHOLDS.L2, mutationScore: 0 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('mutationScore'))).toBe(true)
    }
  })

  it('rejects lineCoverage above 100', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 101 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('lineCoverage'))).toBe(true)
    }
  })

  it('rejects non-object input', () => {
    const result = validateConfig('not-an-object')
    expect(result.ok).toBe(false)
  })

  it('rejects non-string basePackage (#503)', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
      basePackage: 42,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('basePackage'))).toBe(true)
    }
  })

  it('rejects null basePackage (#503)', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
      basePackage: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('basePackage'))).toBe(true)
    }
  })

  it('accepts string basePackage (#503)', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
      basePackage: 'com.example.app',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts absent basePackage (#503)', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    expect(result.ok).toBe(true)
  })
})

describe('migrateV1ToV2 — feature flag derivation', () => {
  it('migrates minimal v1 to v2 with L2 defaults', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    }
    const result = migrateV1ToV2(v1)
    expect(result.version).toBe('0.2')
    expect(result.features.debtGates).toBe(true)
    expect(result.features.securityScanning).toBe(true)
    expect(result.features.suppressions).toBe(true)
    expect(result.features.mutationTesting).toBe(true)
    expect(result.features.contractTesting).toBe(false)
    expect(result.features.evidenceHarness).toBe(false)
  })

  it('L1 v1 → all non-suppressions features false', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L1',
      useGitHub: false,
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.debtGates).toBe(false)
    expect(result.features.securityScanning).toBe(false)
    expect(result.features.mutationTesting).toBe(false)
    expect(result.features.evidenceHarness).toBe(false)
    expect(result.features.suppressions).toBe(true)
  })

  it('v1 with enableDebtGates=false overrides L2 default', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      enableDebtGates: false,
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.debtGates).toBe(false)
  })

  it('v1 with enableSecurityScanning=false overrides L2 default', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      enableSecurityScanning: false,
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.securityScanning).toBe(false)
  })

  it('v1 contractType grpc → features.contractTesting=true', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: true,
      contractType: 'grpc',
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.contractTesting).toBe(true)
  })

  it('v1 contractType none → features.contractTesting=false', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: true,
      contractType: 'none',
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.contractTesting).toBe(false)
  })

  it('v1 evidenceRetention.enabled=true → features.evidenceHarness=true', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      evidenceRetention: { enabled: true, retentionDays: 30 },
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.evidenceHarness).toBe(true)
  })

  it('v1 evidenceRetention.enabled=false → features.evidenceHarness=false (not object-presence)', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      evidenceRetention: { enabled: false, retentionDays: 30 },
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.evidenceHarness).toBe(false)
  })

  it('L3 v1 → evidenceHarness defaults to true', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L3',
      useGitHub: false,
    }
    const result = migrateV1ToV2(v1)
    expect(result.features.evidenceHarness).toBe(true)
  })

  it('carries all v1 persisted fields verbatim', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
      isMultiTenant: true,
      hasDatabase: true,
      hasPublicApi: true,
      acceptBetaTools: true,
      thresholdProfile: 'fixed',
      strictnessTier: 'green',
      graceEndsAt: '2026-06-01',
      graceFromLevel: 'L1',
      enableObsidianVault: true,
      invariantTiers: ['architectural', 'security'],
    }
    const result = migrateV1ToV2(v1)
    expect(result.archetype).toBe('backend-web-db')
    expect(result.architectureStyle).toBe('hexagonal')
    expect(result.isMultiTenant).toBe(true)
    expect(result.hasDatabase).toBe(true)
    expect(result.hasPublicApi).toBe(true)
    expect(result.acceptBetaTools).toBe(true)
    expect(result.thresholdProfile).toBe('fixed')
    expect(result.strictnessTier).toBe('green')
    expect(result.graceEndsAt).toBe('2026-06-01')
    expect(result.graceFromLevel).toBe('L1')
    expect(result.enableObsidianVault).toBe(true)
    expect(result.invariantTiers).toEqual(['architectural', 'security'])
  })

  it('uses DEFAULT_THRESHOLDS for target governance level', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L3',
      useGitHub: false,
    }
    const result = migrateV1ToV2(v1)
    expect(result.thresholds).toEqual(DEFAULT_THRESHOLDS.L3)
  })
})

describe('migrateV1ToV2 — already v2', () => {
  it('returns a valid v2 config untouched when version is already 0.2', () => {
    const v2 = {
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
      thresholds: DEFAULT_THRESHOLDS.L2,
    }
    const result = migrateV1ToV2(v2)
    expect(result.version).toBe('0.2')
    expect(result.features.mutationTesting).toBe(true)
  })
})

describe('useGitHub soft-alias migration', () => {
  const baseV2 = {
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
    thresholds: DEFAULT_THRESHOLDS.L2,
  }

  it('derives backend=github from useGitHub:true when decomposition absent', () => {
    const result = migrateV1ToV2({ ...baseV2, useGitHub: true })
    expect(result.decomposition?.backend).toBe('github')
  })

  it('derives backend=markdown from useGitHub:false when decomposition absent', () => {
    const result = migrateV1ToV2({ ...baseV2, useGitHub: false })
    expect(result.decomposition?.backend).toBe('markdown')
  })

  it('does not override explicit decomposition.backend', () => {
    const result = migrateV1ToV2({
      ...baseV2,
      useGitHub: true,
      decomposition: { backend: 'markdown' },
    })
    expect(result.decomposition?.backend).toBe('markdown')
  })

  it('v1 migration derives backend from useGitHub silently', () => {
    const v1 = {
      governanceLevel: 'L2',
      useGitHub: true,
      tools: ['claude'],
    }
    const result = migrateV1ToV2(v1)
    expect(result.decomposition?.backend).toBe('github')
  })
})

const BASE_VALID = {
  version: '0.2',
  tools: ['claude'],
  governanceLevel: 'L1',
  useGitHub: false,
  features: {
    contractTesting: false,
    mutationTesting: false,
    securityScanning: false,
    evidenceHarness: false,
    debtGates: false,
    suppressions: true,
  },
  thresholds: DEFAULT_THRESHOLDS.L1,
}

describe('validateConfig — channel field (#662)', () => {
  it('accepts config without channel (absent = default latest)', () => {
    expect(validateConfig(BASE_VALID).ok).toBe(true)
  })

  it.each(['latest', 'beta', 'canary'])('accepts channel="%s"', (ch) => {
    const r = validateConfig({ ...BASE_VALID, channel: ch })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.channel).toBe(ch)
  })

  it('rejects invalid channel value', () => {
    const r = validateConfig({ ...BASE_VALID, channel: 'preview' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('channel'))).toBe(true)
  })

  it('rejects typo channel value', () => {
    const r = validateConfig({ ...BASE_VALID, channel: 'latst' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('channel'))).toBe(true)
  })

  it('round-trips channel=beta through fixture file', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const raw = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../fixtures/compat/v0.2.0-channel/arbiter.json'),
        'utf-8',
      ),
    ) as unknown
    const r = validateConfig(raw)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.channel).toBe('beta')
  })

  it('rejects bad-channel fixture', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const raw = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../fixtures/compat/v0.2.0-bad-channel/arbiter.json'),
        'utf-8',
      ),
    ) as unknown
    const r = validateConfig(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('channel'))).toBe(true)
  })
})

describe('validateConfig — constrained-union optionals (#1579, #1589)', () => {
  it('accepts a config without any of the optional enums', () => {
    expect(validateConfig(BASE_VALID).ok).toBe(true)
  })

  it.each([
    ['databaseEngine', 'postgresql'],
    ['databaseEngine', 'sqlite'],
    ['databaseEngine', 'none'],
    ['strictnessTier', 'pedantic'],
    ['strictnessTier', 'practical'],
    ['thresholdProfile', 'scaled'],
    ['thresholdProfile', 'fixed'],
    ['contractType', 'rest-owned'],
    ['contractType', 'message-queue'],
    ['contractType', 'none'],
    // #1693: runnerProfile axis (ADR-101).
    ['runnerProfile', 'solo'],
    ['runnerProfile', 'fleet'],
  ])('accepts %s="%s"', (field, value) => {
    const r = validateConfig({ ...BASE_VALID, [field]: value })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['databaseEngine', 'redis'],
    ['databaseEngine', 'postgres'],
    ['strictnessTier', 'pedantik'],
    ['strictnessTier', 'practical '],
    ['thresholdProfile', 'scaledd'],
    ['contractType', 'rest'],
    // #1693: runnerProfile axis (ADR-101).
    ['runnerProfile', 'sfleet'],
  ])('rejects typo %s="%s" with a precise diagnostic', (field, value) => {
    const r = validateConfig({ ...BASE_VALID, [field]: value })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith(`${field} must be one of`))).toBe(true)
    }
  })

  it('rejects a non-string enum value reporting its type', () => {
    const r = validateConfig({ ...BASE_VALID, databaseEngine: 42 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('databaseEngine'))).toBe(true)
  })
})

describe('validateConfig — nested provider unions (#1632)', () => {
  it.each([
    ['auth', 'keycloak'],
    ['auth', 'saas-auth0'],
    ['auth', 'none'],
    ['observability', 'signoz'],
    ['observability', 'prom-grafana-loki-jaeger'],
    ['observability', 'none'],
  ])('accepts %s.provider="%s"', (field, value) => {
    const r = validateConfig({ ...BASE_VALID, [field]: { provider: value } })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['auth', 'keycloack'],
    ['auth', 'auth0'],
    ['observability', 'signozz'],
    ['observability', 'grafana'],
  ])('rejects typo %s.provider="%s" with a precise diagnostic', (field, value) => {
    const r = validateConfig({ ...BASE_VALID, [field]: { provider: value } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith(`${field}.provider must be one of`))).toBe(true)
    }
  })

  it('rejects a non-string provider reporting its type', () => {
    const r = validateConfig({ ...BASE_VALID, auth: { provider: 42 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('auth.provider'))).toBe(true)
  })
})

// #1676/#1677: provider + deploy-target unions are exported for the `arbiter init`
// CLI cast site to validate against (no silent coercion of an unknown flag value).
describe('exported provider/deploy-target unions (#1676/#1677)', () => {
  it('AUTH_PROVIDERS carries known members and rejects a typo', () => {
    expect(AUTH_PROVIDERS.has('keycloak')).toBe(true)
    expect(AUTH_PROVIDERS.has('none')).toBe(true)
    expect(AUTH_PROVIDERS.has('keycloack')).toBe(false)
  })

  it('OBSERVABILITY_PROVIDERS carries known members and rejects a typo', () => {
    expect(OBSERVABILITY_PROVIDERS.has('signoz')).toBe(true)
    expect(OBSERVABILITY_PROVIDERS.has('none')).toBe(true)
    expect(OBSERVABILITY_PROVIDERS.has('grafana')).toBe(false)
  })

  it('DEPLOY_TARGETS covers exactly the documented flag values', () => {
    expect([...DEPLOY_TARGETS].sort()).toEqual(
      ['aws-ecs', 'azure-container-app', 'gcp-cloud-run', 'ghcr', 'nas-compose', 'none'].sort(),
    )
  })

  it('isDeployTarget narrows known values and rejects unknown ones', () => {
    expect(isDeployTarget('gcp-cloud-run')).toBe(true)
    expect(isDeployTarget('ghcr')).toBe(true)
    expect(isDeployTarget('nas-compose')).toBe(true)
    expect(isDeployTarget('none')).toBe(true)
    expect(isDeployTarget('bogus')).toBe(false)
    expect(isDeployTarget('')).toBe(false)
  })
})

describe('DEFAULT_THRESHOLDS', () => {
  it('L2 has lineCoverage=80, branchCoverage=70, mutationScore=80', () => {
    expect(DEFAULT_THRESHOLDS.L2.lineCoverage).toBe(80)
    expect(DEFAULT_THRESHOLDS.L2.branchCoverage).toBe(70)
    expect(DEFAULT_THRESHOLDS.L2.mutationScore).toBe(80)
  })

  it('L3 has stricter values than L2', () => {
    expect(DEFAULT_THRESHOLDS.L3.lineCoverage).toBeGreaterThan(DEFAULT_THRESHOLDS.L2.lineCoverage)
    expect(DEFAULT_THRESHOLDS.L3.mutationScore).toBeGreaterThanOrEqual(
      DEFAULT_THRESHOLDS.L2.mutationScore,
    )
    expect(DEFAULT_THRESHOLDS.L3.branchCoverage).toBeGreaterThan(
      DEFAULT_THRESHOLDS.L2.branchCoverage,
    )
  })

  it('L3/L4 branch floor reaches the gold bar of 88% (#1511)', () => {
    // Gold-standard branch-coverage bar is >=0.88; the top governance tiers must
    // not sit ~8pp below it. Enforced as the non-droppable vitest `branches:` floor.
    expect(DEFAULT_THRESHOLDS.L3.branchCoverage).toBe(88)
    expect(DEFAULT_THRESHOLDS.L4.branchCoverage).toBe(88)
  })

  it('L1 has more lenient values than L2', () => {
    expect(DEFAULT_THRESHOLDS.L1.lineCoverage).toBeLessThan(DEFAULT_THRESHOLDS.L2.lineCoverage)
    expect(DEFAULT_THRESHOLDS.L1.cyclomaticComplexity).toBeGreaterThan(
      DEFAULT_THRESHOLDS.L2.cyclomaticComplexity,
    )
  })
})

describe('validateConfig — thresholds auto-fill', () => {
  const base = {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
  }

  it('auto-fills thresholds from DEFAULT_THRESHOLDS when missing', () => {
    const result = validateConfig({ ...base })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.thresholds).toEqual(DEFAULT_THRESHOLDS.L2)
    }
  })

  it('auto-fills correct thresholds per governance level', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const result = validateConfig({ ...base, governanceLevel: level })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.config.thresholds).toEqual(DEFAULT_THRESHOLDS[level])
      }
    }
  })

  it('does not overwrite explicitly provided thresholds', () => {
    const custom = {
      lineCoverage: 99,
      branchCoverage: 99,
      mutationScore: 99,
      cyclomaticComplexity: 1,
      methodLength: 10,
      maxParams: 2,
    }
    const result = validateConfig({ ...base, thresholds: custom })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.thresholds.lineCoverage).toBe(99)
    }
  })
})

describe('validateConfig — frontend block (#1124)', () => {
  const base = {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
    thresholds: DEFAULT_THRESHOLDS.L2,
  }

  it('accepts valid frontend block', () => {
    const result = validateConfig({
      ...base,
      frontend: { framework: 'vue', stateManager: 'pinia' },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts scoped npm package names for stateManager', () => {
    const result = validateConfig({ ...base, frontend: { stateManager: '@tanstack/query' } })
    expect(result.ok).toBe(true)
  })

  it('accepts absent frontend block', () => {
    const result = validateConfig({ ...base })
    expect(result.ok).toBe(true)
  })

  it('rejects invalid framework value', () => {
    const result = validateConfig({ ...base, frontend: { framework: 'angular' } })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/frontend\.framework/i)]),
      )
  })

  it('rejects non-string framework', () => {
    const result = validateConfig({ ...base, frontend: { framework: 42 } })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/frontend\.framework/i)]),
      )
  })

  it('rejects non-string stateManager', () => {
    const result = validateConfig({ ...base, frontend: { stateManager: true } })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/frontend\.stateManager/i)]),
      )
  })

  it('rejects non-object frontend', () => {
    const result = validateConfig({ ...base, frontend: 'vue' })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/frontend/i)]))
  })
})
