import { describe, it, expect } from 'vitest'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import {
  getFilteredInvariants,
  getInvariantsByTier,
  presetToTiers,
  defaultPresetForLevel,
} from '../../src/invariants/filter.js'
import type { InvariantTier } from '../../src/invariants/types.js'

const LANGUAGES = ['typescript', 'java', 'rust', 'go', 'python'] as const
const ALL_TIERS: InvariantTier[] = [
  'architectural',
  'data',
  'security',
  'operational',
  'governance',
]

// ---------------------------------------------------------------------------
// INVARIANT_CATALOG structure
// ---------------------------------------------------------------------------

describe('INVARIANT_CATALOG', () => {
  it('has exactly 104 entries', () => {
    // Updated in #1127: +4 (INV-102/103/104 boundary purity + INV-105 token discipline)
    expect(INVARIANT_CATALOG).toHaveLength(104)
  })

  it('all IDs are unique', () => {
    const ids = INVARIANT_CATALOG.map((inv) => inv.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(104)
  })

  it('all IDs match INV-XX pattern sequentially (INV-01..82)', () => {
    const ids = INVARIANT_CATALOG.map((inv) => inv.id)
    for (let i = 1; i <= 82; i++) {
      expect(ids).toContain(`INV-${String(i).padStart(2, '0')}`)
    }
  })

  it('all have required fields: id, tier, title, description, alwaysActive', () => {
    for (const inv of INVARIANT_CATALOG) {
      expect(inv.id, `${inv.id} missing id`).toBeTruthy()
      expect(inv.tier, `${inv.id} missing tier`).toBeTruthy()
      expect(inv.title, `${inv.id} missing title`).toBeTruthy()
      expect(inv.description, `${inv.id} missing description`).toBeTruthy()
      expect(typeof inv.alwaysActive, `${inv.id} alwaysActive must be boolean`).toBe('boolean')
    }
  })

  it('Tier 1 (architectural) non-optIn invariants are alwaysActive', () => {
    const tier1 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'architectural' && !inv.optInGroup)
    expect(tier1.length).toBeGreaterThan(0)
    for (const inv of tier1) {
      expect(inv.alwaysActive, `${inv.id} should be alwaysActive`).toBe(true)
    }
  })

  it('Tier 5 (governance) non-optIn invariants are alwaysActive', () => {
    const tier5 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'governance' && !inv.optInGroup)
    expect(tier5.length).toBeGreaterThan(0)
    for (const inv of tier5) {
      expect(inv.alwaysActive, `${inv.id} should be alwaysActive`).toBe(true)
    }
  })

  it('Tier 2, 4 invariants are NOT alwaysActive', () => {
    // INV-11/12/13 (security tier) are intentionally alwaysActive=true at L2+ (M24 upgrade)
    const optional = INVARIANT_CATALOG.filter(
      (inv) => inv.tier === 'data' || inv.tier === 'operational',
    )
    expect(optional.length).toBeGreaterThan(0)
    for (const inv of optional) {
      expect(inv.alwaysActive, `${inv.id} should NOT be alwaysActive`).toBe(false)
    }
  })

  it('INV-11/12/13 (security) are alwaysActive with minGovernanceLevel L2 (M24)', () => {
    for (const id of ['INV-11', 'INV-12', 'INV-13']) {
      const inv = INVARIANT_CATALOG.find((i) => i.id === id)
      expect(inv?.alwaysActive, `${id} should be alwaysActive`).toBe(true)
      expect(inv?.minGovernanceLevel, `${id} should require L2`).toBe('L2')
    }
  })

  it('has exactly 14 Tier 1 invariants', () => {
    const tier1 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'architectural')
    expect(tier1).toHaveLength(14)
  })

  it('has exactly 6 Tier 2 invariants', () => {
    const tier2 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'data')
    expect(tier2).toHaveLength(6)
  })

  it('has exactly 16 Tier 3 invariants', () => {
    const tier3 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'security')
    expect(tier3).toHaveLength(16)
  })

  it('has exactly 33 Tier 4 invariants', () => {
    // Updated in #1127: +4 (INV-102/103/104/105 — FE governance, tier=operational)
    const tier4 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'operational')
    expect(tier4).toHaveLength(33)
  })

  it('has exactly 35 Tier 5 invariants', () => {
    const tier5 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'governance')
    expect(tier5).toHaveLength(35)
  })

  it('INV-38 (phase lifecycle enforcement) is in Tier 5 Governance and alwaysActive', () => {
    const inv38 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-38')
    expect(inv38).toBeDefined()
    expect(inv38?.tier).toBe('governance')
    expect(inv38?.alwaysActive).toBe(true)
  })

  it('INV-53 (exit-code universal contract) is governance tier, alwaysActive, references 0/1/2', () => {
    const inv53 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-53')
    expect(inv53).toBeDefined()
    expect(inv53?.tier).toBe('governance')
    expect(inv53?.alwaysActive).toBe(true)
    expect(inv53?.description).toContain('0=PASS')
    expect(inv53?.description).toContain('1=FAIL')
    expect(inv53?.description).toContain('2=ERROR')
  })

  it('language-specific invariants (INV-04, INV-05, INV-06) have languageDetail for all 5 languages', () => {
    const langSpecific = INVARIANT_CATALOG.filter(
      (inv) => inv.languages !== undefined && inv.languageDetail !== undefined,
    )
    expect(langSpecific.length).toBeGreaterThan(0)
    for (const inv of langSpecific) {
      for (const lang of LANGUAGES) {
        expect(
          inv.languageDetail?.[lang],
          `${inv.id} missing languageDetail for ${lang}`,
        ).toBeTruthy()
      }
    }
  })

  it('languageDetail covers every language declared in languages (#680)', () => {
    for (const inv of INVARIANT_CATALOG) {
      if (!inv.languages || !inv.languageDetail) continue
      for (const lang of inv.languages) {
        expect(
          inv.languageDetail[lang],
          `${inv.id} missing languageDetail for declared language "${lang}"`,
        ).toBeTruthy()
      }
    }
  })

  it('INV-04 is in Tier 1 and is language-specific', () => {
    const inv04 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-04')
    expect(inv04?.tier).toBe('architectural')
    expect(inv04?.languages).toBeDefined()
    expect(inv04?.languageDetail?.typescript).toContain('any')
    expect(inv04?.languageDetail?.rust).toContain('unwrap')
    expect(inv04?.languageDetail?.java).toContain('raw')
    expect(inv04?.languageDetail?.go).toContain('error')
    expect(inv04?.languageDetail?.python).toContain('annotation')
  })

  it('INV-21 (TODO reference) is in Tier 5 Governance', () => {
    const inv21 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-21')
    expect(inv21?.tier).toBe('governance')
    expect(inv21?.title.toLowerCase()).toContain('todo')
  })

  it('INV-26 (TDD) is L2+ gated', () => {
    const inv26 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-26')
    expect(inv26?.minGovernanceLevel).toBe('L2')
  })

  it('INV-27 (evidence artifacts) is L4 gated', () => {
    const inv27 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-27')
    expect(inv27?.minGovernanceLevel).toBe('L4')
  })

  it('INV-28 (SSOT check) is L3 gated', () => {
    const inv28 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-28')
    expect(inv28?.minGovernanceLevel).toBe('L3')
  })

  it('INV-29 (no MockMvc) is architectural, alwaysActive, Java-only', () => {
    const inv29 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-29')
    expect(inv29?.tier).toBe('architectural')
    expect(inv29?.alwaysActive).toBe(true)
    expect(inv29?.languages).toEqual(['java'])
    expect(inv29?.title.toLowerCase()).toContain('mockmvc')
  })

  it('INV-30 (mutation testing) is operational, not alwaysActive, L2+, Java-only', () => {
    const inv30 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-30')
    expect(inv30?.tier).toBe('operational')
    expect(inv30?.alwaysActive).toBe(false)
    expect(inv30?.minGovernanceLevel).toBe('L2')
    expect(inv30?.languages).toEqual(['java'])
    expect(inv30?.title.toLowerCase()).toMatch(/mutation|pitest|pit/)
  })
})

// ---------------------------------------------------------------------------
// getFilteredInvariants
// ---------------------------------------------------------------------------

describe('getFilteredInvariants', () => {
  it('always includes Tier 1 and Tier 5 even when only essential tiers provided', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L2',
      invariantTiers: ['architectural', 'governance'],
    })
    const ids = result.map((inv) => inv.id)
    // All 6 architectural invariants
    expect(ids).toContain('INV-01')
    expect(ids).toContain('INV-06')
    // All always-active governance invariants (excl L3-gated at L2)
    expect(ids).toContain('INV-21')
    expect(ids).toContain('INV-25')
  })

  it('excludes optional tier invariants when tier not in config', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L2',
      invariantTiers: ['architectural', 'governance'],
    })
    const ids = result.map((inv) => inv.id)
    // Data tier excluded
    expect(ids).not.toContain('INV-07')
    expect(ids).not.toContain('INV-08')
    // INV-11/12/13 are alwaysActive=true (M24 upgrade) so they bypass tier selection
    expect(ids).toContain('INV-11')
    expect(ids).toContain('INV-12')
    expect(ids).toContain('INV-13')
    // Operational tier excluded
    expect(ids).not.toContain('INV-16')
  })

  it('includes optional tier invariants when tier is in config', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain('INV-07') // data
    expect(ids).toContain('INV-11') // security
    expect(ids).toContain('INV-16') // operational
  })

  it('excludes language-specific invariants for non-matching language', () => {
    // INV-04 for Rust should not appear when language is typescript
    // But since INV-04 applies to all 5 specific languages, we check the text
    const tsResult = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    })
    const inv04 = tsResult.find((inv) => inv.id === 'INV-04')
    expect(inv04).toBeDefined()
    // The resolved title for typescript should mention 'any', not 'unwrap'
    const resolvedTitle = inv04?.languageDetail?.typescript ?? inv04?.title ?? ''
    expect(resolvedTitle).toContain('any')
    expect(resolvedTitle).not.toContain('unwrap')
  })

  it("excludes invariants for language 'unknown' when they require specific languages", () => {
    const result = getFilteredInvariants({
      language: 'unknown',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    // INV-04 requires a specific language — should not appear for unknown
    expect(ids).not.toContain('INV-04')
    // INV-05 requires a specific language — should not appear for unknown
    expect(ids).not.toContain('INV-05')
    // INV-01 (no language restriction) should appear
    expect(ids).toContain('INV-01')
  })

  it('excludes L2+ invariants at L1', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L1',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    // INV-09 (audit trail) is L2+
    expect(ids).not.toContain('INV-09')
    // INV-26 (TDD mandatory) is L2+
    expect(ids).not.toContain('INV-26')
    // INV-27 (evidence) is L4
    expect(ids).not.toContain('INV-27')
  })

  it('includes L2+ invariants at L2', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain('INV-09') // L2+
    expect(ids).toContain('INV-26') // L2+
    expect(ids).not.toContain('INV-27') // L4 only
  })

  it('includes all governance-level invariants at L3', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain('INV-09') // L2+
    expect(ids).toContain('INV-26') // L2+
    expect(ids).not.toContain('INV-27') // L4 only
    expect(ids).toContain('INV-28') // L3
    expect(ids).not.toContain('INV-33') // L4 only
  })

  it('includes L4-only invariants at L4', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L4',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain('INV-27') // L4
    expect(ids).toContain('INV-28') // L3+
    expect(ids).toContain('INV-33') // L4
  })

  it('excludes L3/L4 invariants at L2', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    expect(ids).not.toContain('INV-27')
    expect(ids).not.toContain('INV-28')
    expect(ids).not.toContain('INV-33')
  })

  it('returns 68 for TypeScript + L3 + all tiers (INV-27/33 moved to L4, INV-29/30/44 Java-only + selfOnly excluded, INV-82 + INV-95/97/98/99 + INV-100 + INV-101 + INV-102/103/104/105/106 included)', () => {
    // Updated in #1127: +4 (INV-102/103/104/105 — typescript, L2, operational tier)
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    expect(result).toHaveLength(68)
    const ids = result.map((inv) => inv.id)
    expect(ids).not.toContain('INV-29')
    expect(ids).not.toContain('INV-30')
    expect(ids).toContain('INV-31')
    expect(ids).not.toContain('INV-32')
    expect(ids).not.toContain('INV-33') // L4 only
    expect(ids).toContain('INV-34')
    expect(ids).toContain('INV-35')
    expect(ids).not.toContain('INV-36')
    expect(ids).toContain('INV-37')
    expect(ids).toContain('INV-40')
  })

  it('returns fewer than 57 for unknown language (language-specific excluded)', () => {
    const result = getFilteredInvariants({
      language: 'unknown',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    expect(result.length).toBeLessThan(57)
  })

  it('INV-29 appears for Java at all governance levels (alwaysActive, essential tiers)', () => {
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
      const result = getFilteredInvariants({
        language: 'java',
        governanceLevel: level,
        invariantTiers: ['architectural', 'governance'],
      })
      const ids = result.map((inv) => inv.id)
      expect(ids, `INV-29 missing for Java at ${level}`).toContain('INV-29')
    }
  })

  it('INV-29 does not appear for non-Java languages', () => {
    for (const lang of ['typescript', 'rust', 'go', 'python'] as const) {
      const result = getFilteredInvariants({
        language: lang,
        governanceLevel: 'L3',
        invariantTiers: ALL_TIERS,
      })
      const ids = result.map((inv) => inv.id)
      expect(ids, `INV-29 should not appear for ${lang}`).not.toContain('INV-29')
    }
  })

  it('INV-30 appears for Java at L2+ with operational tier', () => {
    for (const level of ['L2', 'L3', 'L4'] as const) {
      const result = getFilteredInvariants({
        language: 'java',
        governanceLevel: level,
        invariantTiers: ALL_TIERS,
      })
      const ids = result.map((inv) => inv.id)
      expect(ids, `INV-30 missing for Java at ${level}`).toContain('INV-30')
    }
  })

  it('INV-30 does not appear for Java at L1', () => {
    const result = getFilteredInvariants({
      language: 'java',
      governanceLevel: 'L1',
      invariantTiers: ALL_TIERS,
    })
    expect(result.map((inv) => inv.id)).not.toContain('INV-30')
  })

  it('INV-30 does not appear for non-Java languages', () => {
    for (const lang of ['typescript', 'rust', 'go', 'python'] as const) {
      const result = getFilteredInvariants({
        language: lang,
        governanceLevel: 'L3',
        invariantTiers: ALL_TIERS,
      })
      expect(result.map((inv) => inv.id)).not.toContain('INV-30')
    }
  })

  it('Java + L2 + all tiers returns 64 invariants (L3-gated INV-28 + L4-gated INV-27/33 + selfOnly excluded, INV-82 + INV-95/97/98/99 + INV-100 + INV-101 included)', () => {
    const result = getFilteredInvariants({
      language: 'java',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    })
    expect(result).toHaveLength(64)
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain('INV-29')
    expect(ids).toContain('INV-30')
    expect(ids).toContain('INV-31')
    expect(ids).not.toContain('INV-32')
    expect(ids).toContain('INV-34')
    expect(ids).toContain('INV-35')
    expect(ids).not.toContain('INV-27')
    expect(ids).not.toContain('INV-28')
  })

  it('Java + L3 + all tiers returns 65 invariants (INV-27/33 moved to L4, selfOnly excluded, INV-82 + INV-95/97/98/99 + INV-100 + INV-101 included)', () => {
    const result = getFilteredInvariants({
      language: 'java',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    expect(result).toHaveLength(65)
  })

  it('essential preset at L1 returns minimal set', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L1',
      invariantTiers: presetToTiers('essential'),
    })
    const tiers = new Set(result.map((inv) => inv.tier))
    expect(tiers.has('architectural')).toBe(true)
    expect(tiers.has('governance')).toBe(true)
    expect(tiers.has('data')).toBe(false)
    expect(tiers.has('security')).toBe(false)
    expect(tiers.has('operational')).toBe(false)
  })

  // selfOnly filtering (#682)
  it('default excludes selfOnly invariants (target-project generation context)', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    const ids = result.map((inv) => inv.id)
    expect(ids).not.toContain('INV-32')
    expect(ids).not.toContain('INV-45')
    expect(ids).not.toContain('INV-49')
    expect(ids).not.toContain('INV-50')
    expect(ids).not.toContain('INV-51')
  })

  it('includeArbiterInternal:true includes selfOnly invariants', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
      includeArbiterInternal: true,
    })
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain('INV-32')
    expect(ids).toContain('INV-45')
    expect(ids).toContain('INV-49')
    expect(ids).toContain('INV-50')
    expect(ids).toContain('INV-51')
  })

  it('catalog has exactly 20 selfOnly invariants (#682, #862, #878, #879, #881, #883, #886)', () => {
    const selfOnly = INVARIANT_CATALOG.filter((inv) => inv.selfOnly === true)
    expect(selfOnly).toHaveLength(20)
    const ids = selfOnly.map((inv) => inv.id)
    expect(ids).toContain('INV-32')
    expect(ids).toContain('INV-36')
    expect(ids).toContain('INV-39')
    expect(ids).toContain('INV-45')
    expect(ids).toContain('INV-46')
    expect(ids).toContain('INV-47')
    expect(ids).toContain('INV-48')
    expect(ids).toContain('INV-49')
    expect(ids).toContain('INV-50')
    expect(ids).toContain('INV-51')
    expect(ids).toContain('INV-52')
    expect(ids).toContain('INV-86')
    expect(ids).toContain('INV-87')
    expect(ids).toContain('INV-88')
    expect(ids).toContain('INV-90')
    expect(ids).toContain('INV-93')
  })
})

// ---------------------------------------------------------------------------
// getInvariantsByTier
// ---------------------------------------------------------------------------

describe('getInvariantsByTier', () => {
  it('groups invariants by tier', () => {
    const all = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    const grouped = getInvariantsByTier(all)
    expect(grouped.get('architectural')).toBeDefined()
    expect(grouped.get('data')).toBeDefined()
    expect(grouped.get('security')).toBeDefined()
    expect(grouped.get('operational')).toBeDefined()
    expect(grouped.get('governance')).toBeDefined()
  })

  it('preserves order within each tier', () => {
    const all = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    const grouped = getInvariantsByTier(all)
    const architectural = grouped.get('architectural') ?? []
    const ids = architectural.map((inv) => inv.id)
    // Should be in ascending INV order (numeric, not lexicographic — handles INV-100+)
    const numSort = (a: string, b: string) =>
      parseInt(a.replace('INV-', ''), 10) - parseInt(b.replace('INV-', ''), 10)
    expect(ids).toEqual([...ids].sort(numSort))
  })

  it('empty input produces empty map', () => {
    const grouped = getInvariantsByTier([])
    expect(grouped.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// presetToTiers
// ---------------------------------------------------------------------------

describe('presetToTiers', () => {
  it('essential returns only architectural and governance', () => {
    const tiers = presetToTiers('essential')
    expect(tiers).toContain('architectural')
    expect(tiers).toContain('governance')
    expect(tiers).not.toContain('data')
    expect(tiers).not.toContain('security')
    expect(tiers).not.toContain('operational')
  })

  it('standard returns architectural, data, operational, governance', () => {
    const tiers = presetToTiers('standard')
    expect(tiers).toContain('architectural')
    expect(tiers).toContain('data')
    expect(tiers).toContain('operational')
    expect(tiers).toContain('governance')
    expect(tiers).not.toContain('security')
  })

  it('full returns all 5 tiers', () => {
    const tiers = presetToTiers('full')
    expect(tiers).toContain('architectural')
    expect(tiers).toContain('data')
    expect(tiers).toContain('security')
    expect(tiers).toContain('operational')
    expect(tiers).toContain('governance')
    expect(tiers).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// defaultPresetForLevel
// ---------------------------------------------------------------------------

describe('defaultPresetForLevel', () => {
  it('L1 defaults to essential', () => {
    expect(defaultPresetForLevel('L1')).toBe('essential')
  })

  it('L2 defaults to standard', () => {
    expect(defaultPresetForLevel('L2')).toBe('standard')
  })

  it('L3 defaults to full', () => {
    expect(defaultPresetForLevel('L3')).toBe('full')
  })
})

// ---------------------------------------------------------------------------
// T9 — INV-73 W4 transition state (#880)
// ---------------------------------------------------------------------------

describe('INV-73 migration status', () => {
  it('INV-73 has migrationStatus: transition (W4 self-only CI tier baseline)', () => {
    const inv73 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-73')
    expect(inv73, 'INV-73 must exist in catalog').toBeDefined()
    expect(inv73!.migrationStatus).toBe('transition')
  })

  it('INV-73 minPresent is 6 (6 canonical workflows in W10 baseline: 01+02+03+06+07+09)', () => {
    const inv73 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-73')
    expect(inv73!.minPresent).toBe(6)
  })
})
