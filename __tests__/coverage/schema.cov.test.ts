// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  validateConfig,
  validateConformanceThresholds,
  autoFillConformanceThresholds,
  DEFAULT_TASK_TIERS,
  DEFAULT_THRESHOLDS,
  AUTONOMY_LEVELS,
  VALID_GATE_LEVELS,
  VALID_COLLABORATION_MODES,
  VALID_SOLO_MERGE_MODES,
  VALID_BRANCHING_STRATEGIES,
  CURRENT_CONFIG_SCHEMA_VERSION,
} from '../../src/config/schema.js'

/** A minimal config that passes validateConfig. */
function validBase(): Record<string, unknown> {
  return {
    version: '0.2',
    governanceLevel: 'L2',
    tools: ['claude'],
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  }
}

function errorsOf(raw: unknown): string[] {
  const r = validateConfig(raw)
  expect(r.ok).toBe(false)
  return r.ok ? [] : r.errors
}

describe('exported constants', () => {
  it('exposes a stable schema version and tier/threshold defaults', () => {
    expect(CURRENT_CONFIG_SCHEMA_VERSION).toBe(4)
    expect(DEFAULT_TASK_TIERS.XS.planDepth).toBe('minimal')
    expect(DEFAULT_TASK_TIERS.XS.reviewAgentCount).toBe(1)
    expect(DEFAULT_TASK_TIERS.S.reviewAgentCount).toBe(1)
    expect(DEFAULT_TASK_TIERS.Standard.reviewAgentCount).toBe(2)
    expect(DEFAULT_THRESHOLDS.L1.lineCoverage).toBe(60)
    expect(DEFAULT_THRESHOLDS.L4.cyclomaticComplexity).toBe(10)
  })

  it('exposes the enumerated value sets', () => {
    expect(AUTONOMY_LEVELS).toEqual(['L0', 'L1', 'L2', 'L3'])
    expect(VALID_GATE_LEVELS).toEqual(['L1', 'L2'])
    expect(VALID_COLLABORATION_MODES.has('trunk-solo')).toBe(true)
    expect(VALID_SOLO_MERGE_MODES.has('pr-ff')).toBe(true)
    expect(VALID_BRANCHING_STRATEGIES.has('github-flow')).toBe(true)
    expect(VALID_BRANCHING_STRATEGIES.has('nonsense')).toBe(false)
  })
})

describe('validateConformanceThresholds', () => {
  it('rejects non-object / null input', () => {
    expect(validateConformanceThresholds(null)).toContain(
      'conformanceThresholds must be an object',
    )
    expect(validateConformanceThresholds(42)).toContain(
      'conformanceThresholds must be an object',
    )
  })

  it('reports each missing/mistyped field', () => {
    const errs = validateConformanceThresholds({
      tier1Members: 'not-an-array',
      familyWeights: null,
      goldTier2Gate: 'high',
    })
    expect(errs).toContain('conformanceThresholds.tier1Members must be an array')
    expect(errs).toContain('conformanceThresholds.familyWeights must be an object')
    expect(errs).toContain('conformanceThresholds.goldTier2Gate must be a number')
  })

  it('returns no errors for a fully valid object', () => {
    const errs = validateConformanceThresholds({
      tier1Members: ['D-GATE-GREEN'],
      familyWeights: { discipline: 0.15 },
      goldTier2Gate: 0.88,
    })
    expect(errs).toEqual([])
  })
})

describe('autoFillConformanceThresholds', () => {
  it('returns the per-level base when no brownfield class is given', () => {
    const l1 = autoFillConformanceThresholds('L1')
    expect(l1.goldTier2Gate).toBe(0.85)
    const l4 = autoFillConformanceThresholds('L4')
    expect(l4.goldTier2Gate).toBe(0.92)
    expect(l4.tier1Members).toContain('D-GATE-GREEN')
  })

  it('applies the brownfield overlay over the base when a class is given', () => {
    const heavy = autoFillConformanceThresholds('L4', 'heavy')
    expect(heavy.goldTier2Gate).toBe(0.7)
    const gold = autoFillConformanceThresholds('L1', 'gold')
    expect(gold.goldTier2Gate).toBe(0.9)
    // base fields survive the overlay merge
    expect(gold.familyWeights.discipline).toBe(0.15)
  })
})

describe('validateConfig — top-level shape', () => {
  it('rejects a non-object config', () => {
    const errs = errorsOf('not-an-object')
    expect(errs).toContain('config must be a non-null object')
    expect(errorsOf(null)).toContain('config must be a non-null object')
  })

  it('accepts a minimal valid config', () => {
    const r = validateConfig(validBase())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.version).toBe('0.2')
    }
  })

  it('rejects a missing/non-string version', () => {
    const base = validBase()
    delete base['version']
    expect(errorsOf(base)).toContain('version must be a string')
  })

  it('rejects an invalid governanceLevel and uppercases a valid lowercase one', () => {
    expect(errorsOf({ ...validBase(), governanceLevel: 'L9' })).toEqual(
      expect.arrayContaining([expect.stringContaining('governanceLevel must be one of')]),
    )
    const r = validateConfig({ ...validBase(), governanceLevel: 'l3' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.governanceLevel).toBe('L3')
    }
  })

  it('rejects a non-string governanceLevel', () => {
    expect(errorsOf({ ...validBase(), governanceLevel: 2 })).toEqual(
      expect.arrayContaining([expect.stringContaining('governanceLevel must be one of')]),
    )
  })

  it('rejects tools that are not an array or contain unknown tools', () => {
    expect(errorsOf({ ...validBase(), tools: 'claude' })).toContain(
      'tools must be an array of valid AI tools',
    )
    expect(errorsOf({ ...validBase(), tools: ['claude', 'bogus'] })).toContain(
      'tools must be an array of valid AI tools',
    )
  })

  it('requires useGitHub or permitGitHub to be a boolean', () => {
    const base = validBase()
    delete base['useGitHub']
    expect(errorsOf(base)).toContain('useGitHub or permitGitHub must be a boolean')
    // permitGitHub alone satisfies the requirement
    const r = validateConfig({ ...base, permitGitHub: true })
    expect(r.ok).toBe(true)
  })
})

describe('validateConfig — features', () => {
  it('rejects a non-object features block', () => {
    expect(errorsOf({ ...validBase(), features: [] })).toContain('features must be an object')
  })

  it('rejects a non-boolean required flag', () => {
    const base = validBase()
    const feats = { ...(base['features'] as Record<string, unknown>), debtGates: 'yes' }
    expect(errorsOf({ ...base, features: feats })).toContain(
      'features.debtGates must be a boolean',
    )
  })

  it('rejects non-boolean optional flags when present', () => {
    const base = validBase()
    const feats = {
      ...(base['features'] as Record<string, unknown>),
      selfValidationHarness: 'x',
      soloDevMode: 1,
    }
    const errs = errorsOf({ ...base, features: feats })
    expect(errs).toContain('features.selfValidationHarness must be a boolean')
    expect(errs).toContain('features.soloDevMode must be a boolean')
  })

  it('accepts valid optional flags', () => {
    const base = validBase()
    const feats = {
      ...(base['features'] as Record<string, unknown>),
      selfValidationHarness: true,
      soloDevMode: false,
    }
    expect(validateConfig({ ...base, features: feats }).ok).toBe(true)
  })
})

describe('validateConfig — thresholds', () => {
  it('rejects a non-object thresholds block', () => {
    expect(errorsOf({ ...validBase(), thresholds: 5 })).toContain('thresholds must be an object')
  })

  it('rejects out-of-range coverage values', () => {
    const base = validBase()
    const th = { ...(base['thresholds'] as Record<string, unknown>), lineCoverage: 0 }
    expect(errorsOf({ ...base, thresholds: th })).toContain(
      'thresholds.lineCoverage must be a number between 1 and 100',
    )
    const th2 = { ...(base['thresholds'] as Record<string, unknown>), branchCoverage: 101 }
    expect(errorsOf({ ...base, thresholds: th2 })).toContain(
      'thresholds.branchCoverage must be a number between 1 and 100',
    )
  })

  it('rejects non-positive complexity/length/param values', () => {
    const base = validBase()
    const th = { ...(base['thresholds'] as Record<string, unknown>), maxParams: 0 }
    expect(errorsOf({ ...base, thresholds: th })).toContain(
      'thresholds.maxParams must be a positive number',
    )
  })

  it('auto-fills thresholds from governanceLevel when absent', () => {
    const base = validBase()
    delete base['thresholds']
    const r = validateConfig({ ...base, governanceLevel: 'L3' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.thresholds).toEqual(DEFAULT_THRESHOLDS.L3)
    }
  })

  it('does NOT auto-fill thresholds when governanceLevel is invalid', () => {
    const base = validBase()
    delete base['thresholds']
    const errs = errorsOf({ ...base, governanceLevel: 'BOGUS' })
    // both the level error and the (still-missing) thresholds error appear
    expect(errs).toContain('thresholds must be an object')
  })
})

describe('validateConfig — optional scalars (basePackage, industryOverlay)', () => {
  it('rejects a non-string basePackage but accepts a string', () => {
    expect(errorsOf({ ...validBase(), basePackage: 123 })).toContain(
      'basePackage must be a string',
    )
    expect(validateConfig({ ...validBase(), basePackage: 'com.example' }).ok).toBe(true)
  })

  it('rejects an unknown industryOverlay and a non-string one', () => {
    expect(errorsOf({ ...validBase(), industryOverlay: 'unknown' })).toEqual(
      expect.arrayContaining([expect.stringContaining('industryOverlay must be one of')]),
    )
    expect(errorsOf({ ...validBase(), industryOverlay: 7 })).toEqual(
      expect.arrayContaining([expect.stringContaining('industryOverlay must be one of')]),
    )
  })

  it('accepts a known industryOverlay', () => {
    expect(validateConfig({ ...validBase(), industryOverlay: 'gdpr' }).ok).toBe(true)
  })
})

describe('validateConfig — collaboration axes', () => {
  it('rejects invalid collaborationMode / branchingStrategy / solo.mergeMode', () => {
    const errs = errorsOf({
      ...validBase(),
      collaborationMode: 'lonewolf',
      branchingStrategy: 'gitflow',
      solo: { mergeMode: 'squash' },
    })
    expect(errs.some((e) => e.includes('collaborationMode must be one of'))).toBe(true)
    expect(errs.some((e) => e.includes('branchingStrategy must be one of'))).toBe(true)
    expect(errs.some((e) => e.includes('solo.mergeMode must be one of'))).toBe(true)
  })

  it('accepts valid collaboration axes', () => {
    const r = validateConfig({
      ...validBase(),
      collaborationMode: 'trunk-solo',
      branchingStrategy: 'trunk-direct',
      solo: { mergeMode: 'direct' },
    })
    expect(r.ok).toBe(true)
  })

  it('ignores collaboration axes set to undefined', () => {
    const r = validateConfig({
      ...validBase(),
      collaborationMode: undefined,
      branchingStrategy: undefined,
    })
    expect(r.ok).toBe(true)
  })
})

describe('validateConfig — frontend', () => {
  it('skips validation when frontend is null/absent', () => {
    expect(validateConfig({ ...validBase(), frontend: null }).ok).toBe(true)
  })

  it('rejects a non-object frontend', () => {
    expect(errorsOf({ ...validBase(), frontend: 'react' })).toContain('frontend must be an object')
  })

  it('rejects an unknown framework and non-string framework', () => {
    expect(errorsOf({ ...validBase(), frontend: { framework: 'angular' } })).toEqual(
      expect.arrayContaining([expect.stringContaining('frontend.framework must be one of')]),
    )
    expect(errorsOf({ ...validBase(), frontend: { framework: 9 } })).toContain(
      'frontend.framework must be a string',
    )
  })

  it('rejects a bad stateManager/validationLib identifier and non-string', () => {
    const errs = errorsOf({
      ...validBase(),
      frontend: { stateManager: 'has spaces!', validationLib: 5 },
    })
    expect(errs.some((e) => e.includes('frontend.stateManager must match'))).toBe(true)
    expect(errs).toContain('frontend.validationLib must be a string')
  })

  it('accepts a fully valid frontend block', () => {
    const r = validateConfig({
      ...validBase(),
      frontend: { framework: 'vue', stateManager: 'pinia', validationLib: '@vee-validate/zod' },
    })
    expect(r.ok).toBe(true)
  })
})

describe('validateConfig — lanes', () => {
  it('rejects non-array lanes and invalid values', () => {
    expect(errorsOf({ ...validBase(), lanes: 'frontend' })).toContain('lanes must be an array')
    expect(errorsOf({ ...validBase(), lanes: ['frontend', 'mobile'] })).toEqual(
      expect.arrayContaining([expect.stringContaining('lanes contains invalid value')]),
    )
  })

  it('accepts valid lanes', () => {
    expect(validateConfig({ ...validBase(), lanes: ['frontend', 'backend', 'docs'] }).ok).toBe(true)
  })
})

describe('validateConfig — taskTiers', () => {
  it('rejects a non-object taskTiers', () => {
    expect(errorsOf({ ...validBase(), taskTiers: 3 })).toContain('taskTiers must be an object')
  })

  it('reports each missing required tier', () => {
    const errs = errorsOf({ ...validBase(), taskTiers: { XS: DEFAULT_TASK_TIERS.XS } })
    expect(errs).toContain('taskTiers.S is required')
    expect(errs).toContain('taskTiers.Standard is required')
  })

  it('rejects a non-object tier and bad tier fields', () => {
    const errs = errorsOf({
      ...validBase(),
      taskTiers: {
        XS: 'nope',
        S: { planDepth: 'huge', reviewAgentCount: 3 },
        Standard: { planDepth: 'full', reviewAgentCount: -1 },
      },
    })
    expect(errs).toContain('taskTiers.XS must be an object')
    expect(errs).toContain('taskTiers.S.planDepth must be one of minimal, brief, full')
    expect(errs).toContain('taskTiers.Standard.reviewAgentCount must be a positive integer')
  })

  it('accepts the default task tiers', () => {
    expect(validateConfig({ ...validBase(), taskTiers: DEFAULT_TASK_TIERS }).ok).toBe(true)
  })
})

describe('validateConfig — decomposition', () => {
  it('rejects a non-object decomposition and unknown backend', () => {
    expect(errorsOf({ ...validBase(), decomposition: 'github' })).toContain(
      'decomposition must be an object',
    )
    expect(errorsOf({ ...validBase(), decomposition: { backend: 'gitlab' } })).toEqual(
      expect.arrayContaining([expect.stringContaining('decomposition.backend must be')]),
    )
  })

  it('accepts a valid decomposition backend and an absent backend', () => {
    expect(validateConfig({ ...validBase(), decomposition: { backend: 'markdown' } }).ok).toBe(true)
    expect(validateConfig({ ...validBase(), decomposition: {} }).ok).toBe(true)
  })
})

describe('validateConfig — contextPack', () => {
  it('rejects a non-object contextPack and non-array adrMappings', () => {
    expect(errorsOf({ ...validBase(), contextPack: 1 })).toContain('contextPack must be an object')
    expect(errorsOf({ ...validBase(), contextPack: { adrMappings: 'x' } })).toContain(
      'contextPack.adrMappings must be an array',
    )
  })

  it('reports per-entry problems in adrMappings', () => {
    const errs = errorsOf({
      ...validBase(),
      contextPack: {
        adrMappings: ['not-an-object', { pattern: '', adr: '' }, { pattern: 'src/**', adr: 'ADR-1' }],
      },
    })
    expect(errs).toContain('contextPack.adrMappings[0] must be an object')
    expect(errs).toContain('contextPack.adrMappings[1].pattern must be a non-empty string')
    expect(errs).toContain('contextPack.adrMappings[1].adr must be a non-empty string')
  })

  it('accepts valid adrMappings and an absent adrMappings', () => {
    expect(
      validateConfig({
        ...validBase(),
        contextPack: { adrMappings: [{ pattern: 'src/**', adr: 'ADR-001' }] },
      }).ok,
    ).toBe(true)
    expect(validateConfig({ ...validBase(), contextPack: {} }).ok).toBe(true)
  })
})

describe('validateConfig — automation', () => {
  it('rejects a non-object automation and a bad autonomy level', () => {
    expect(errorsOf({ ...validBase(), automation: 5 })).toContain('automation must be an object')
    expect(errorsOf({ ...validBase(), automation: { autonomy: 'L9' } })).toEqual(
      expect.arrayContaining([expect.stringContaining('automation.autonomy must be one of')]),
    )
  })

  it('rejects bad automation prefs', () => {
    const errs = errorsOf({
      ...validBase(),
      automation: {
        autonomy: 'L1',
        maxParallelWorktrees: 0,
        defaultGateLevel: 'L3',
        affinityBatching: 'yes',
      },
    })
    expect(errs).toContain('automation.maxParallelWorktrees must be a positive integer')
    expect(errs.some((e) => e.includes('automation.defaultGateLevel must be one of'))).toBe(true)
    expect(errs).toContain('automation.affinityBatching must be a boolean')
  })

  it('accepts a fully valid automation block', () => {
    const r = validateConfig({
      ...validBase(),
      automation: {
        autonomy: 'L2',
        maxParallelWorktrees: 3,
        defaultGateLevel: 'L1',
        affinityBatching: true,
      },
    })
    expect(r.ok).toBe(true)
  })
})

describe('validateConfig — channel', () => {
  it('rejects an unknown channel', () => {
    expect(errorsOf({ ...validBase(), channel: 'nightly' })).toEqual(
      expect.arrayContaining([expect.stringContaining('channel must be one of')]),
    )
  })

  it('accepts a valid channel and an absent one', () => {
    expect(validateConfig({ ...validBase(), channel: 'beta' }).ok).toBe(true)
    expect(validateConfig({ ...validBase(), channel: null }).ok).toBe(true)
  })
})

describe('validateConfig — governance', () => {
  it('rejects a non-object governance and an invalid invariants_catalog', () => {
    expect(errorsOf({ ...validBase(), governance: [] })).toContain('governance must be an object')
    expect(errorsOf({ ...validBase(), governance: { invariants_catalog: 'all' } })).toEqual(
      expect.arrayContaining([expect.stringContaining("governance.invariants_catalog must be")]),
    )
  })

  it('accepts a valid invariants_catalog', () => {
    expect(validateConfig({ ...validBase(), governance: { invariants_catalog: 'extended' } }).ok).toBe(
      true,
    )
  })

  it('rejects an invalid constraintScan value (#2037)', () => {
    expect(errorsOf({ ...validBase(), governance: { constraintScan: 'nope' } })).toEqual(
      expect.arrayContaining([expect.stringContaining("governance.constraintScan must be")]),
    )
  })

  it('accepts a valid constraintScan value (#2037)', () => {
    expect(validateConfig({ ...validBase(), governance: { constraintScan: 'off' } }).ok).toBe(true)
    expect(validateConfig({ ...validBase(), governance: { constraintScan: 'on' } }).ok).toBe(true)
  })

  it('rejects a non-array ssotGuardPatterns and a non-string entry (#2045)', () => {
    expect(errorsOf({ ...validBase(), governance: { ssotGuardPatterns: 'AGENTS.md' } })).toEqual(
      expect.arrayContaining([expect.stringContaining('governance.ssotGuardPatterns must be')]),
    )
    expect(errorsOf({ ...validBase(), governance: { ssotGuardPatterns: ['ok', 5] } })).toEqual(
      expect.arrayContaining([expect.stringContaining('governance.ssotGuardPatterns must be')]),
    )
  })

  it('accepts a valid ssotGuardPatterns array (#2045)', () => {
    expect(
      validateConfig({ ...validBase(), governance: { ssotGuardPatterns: ['AGENTS.md', 'docs/ADR/'] } })
        .ok,
    ).toBe(true)
  })
})

describe('validateConfig — kit', () => {
  it('rejects a non-object kit and non-object measure', () => {
    expect(errorsOf({ ...validBase(), kit: 5 })).toContain('kit must be an object')
    expect(errorsOf({ ...validBase(), kit: { measure: 'x' } })).toContain(
      'kit.measure must be an object',
    )
  })

  it('reports per-dimension kit.measure problems', () => {
    const errs = errorsOf({
      ...validBase(),
      kit: {
        measure: {
          'D-A': 'not-an-object',
          'D-B': { status: 'unknown', evidence: [1] },
          'D-C': { status: 'present', evidence: ['ok'], extra: true },
        },
      },
    })
    expect(errs).toContain('kit.measure.D-A must be an object')
    expect(errs).toContain('kit.measure.D-B.status must be present, partial, or missing')
    expect(errs).toContain('kit.measure.D-B.evidence must be an array of strings')
    expect(errs.some((e) => e.includes('kit.measure.D-C has unknown keys'))).toBe(true)
  })

  it('accepts a valid kit block and an absent measure', () => {
    expect(
      validateConfig({
        ...validBase(),
        kit: { measure: { 'D-A': { status: 'present', evidence: ['file.md'] } } },
      }).ok,
    ).toBe(true)
    expect(validateConfig({ ...validBase(), kit: {} }).ok).toBe(true)
  })
})

describe('validateConfig — conformanceThresholds passthrough', () => {
  it('surfaces conformanceThresholds errors through validateConfig', () => {
    const errs = errorsOf({
      ...validBase(),
      conformanceThresholds: { tier1Members: 'x', familyWeights: 1, goldTier2Gate: 'y' },
    })
    expect(errs).toContain('conformanceThresholds.tier1Members must be an array')
  })

  it('accepts a valid conformanceThresholds block', () => {
    const r = validateConfig({
      ...validBase(),
      conformanceThresholds: {
        tier1Members: ['D-GATE-GREEN'],
        familyWeights: { discipline: 0.2 },
        goldTier2Gate: 0.9,
      },
    })
    expect(r.ok).toBe(true)
  })
})
