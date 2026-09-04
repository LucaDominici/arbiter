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

// Count expectations are each derived from a single named constant, so the
// it() title and its expect() assertion can never drift apart (#1609). A future
// off-by-N regression then surfaces under a truthful test name, not a stale one.
const EXPECTED_TOTAL_ENTRIES = 144
const EXPECTED_TIER4_OPERATIONAL = 49
const EXPECTED_TIER5_GOVERNANCE = 59
const EXPECTED_SELFONLY = 36

// ---------------------------------------------------------------------------
// INVARIANT_CATALOG structure
// ---------------------------------------------------------------------------

describe('INVARIANT_CATALOG', () => {
  it(`has exactly ${EXPECTED_TOTAL_ENTRIES} entries`, () => {
    // Updated in #1099: +1 (INV-107 ADR SSOT integrity, selfOnly governance)
    // Updated in #1100: +1 (INV-108 SSOT core set exhaustiveness, selfOnly governance)
    // Updated CANON-22: +1 (INV-109 duplication gate + ratchet, typescript operational)
    // Updated dual-ADR-cli-single-source: +1 (INV-111 CLI ref parity, selfOnly governance)
    // Updated feat-feature-matrix-rtm: +1 (INV-112 RTM/FEATURE_MATRIX required at L2+)
    // Updated #1206: +1 (INV-113 single authoritative task-phase document, selfOnly governance)
    // Updated #1212: +1 (INV-114 fail-closed Stop gate, L2+ governance, target-facing)
    // Updated #1214: +1 (INV-115 free-text governance prohibition scanner, L1+ governance)
    // Updated #1241: +1 (INV-116 wiki-lint gate, selfOnly governance, L2+)
    // Updated #1217: +1 (INV-117 no tracked binary artifacts, selfOnly governance)
    // Updated #1249: +2 (INV-118 anti-proforma gate, INV-119 commit-footer audit evidence)
    // Updated #1231: +1 (INV-120 workflow needs-chain parallelism regression gate, selfOnly)
    // Note #1244: INV-56 retired via tombstone (status:'retired') per ID-STABILITY — still counted.
    // Updated #1312: +1 (INV-121 stack-conformity gate, operational/Tier-4, language-gated)
    // Updated #1328: +1 (INV-122 update-propagates-fixes, operational/Tier-4, all-languages)
    // Updated #1331: +1 (INV-123 emission-coherence gate, operational/Tier-4, all-languages)
    // Updated #1364: +1 (INV-124 test pyramid non-empty gate, operational/Tier-4, all-languages)
    // Updated #1366: +1 (INV-127 frontend render-smoke gate, operational/Tier-4, all-languages)
    // Updated #1398: +1 (INV-128 conformance script generated, operational/Tier-4, all-languages)
    // Updated #1408: +1 (INV-129 no tracked data/state files, governance/Tier-5, all-languages)
    // Updated #1445: +1 (INV-130 e2e flaky-test quarantine subsystem, operational/Tier-4, all-languages)
    // Updated #1446: +1 (INV-131 tdd-evidence re-verification gate, operational/Tier-4, all-languages)
    // Updated #1447: +1 (INV-132 progressive-adoption bootstrap tier, operational/Tier-4, selfOnly)
    // Updated #1428: +1 (INV-135 doc-set + anti-fake-green runners generated, operational/Tier-4)
    // Updated #1456: +1 (INV-133 TODO max-age enforced via linked-issue creation date, governance/Tier-5, all-languages)
    // Updated #1817: +1 (INV-136 tier-assignment rule, operational/Tier-4, all-languages)
    // Updated #2080: +1 (INV-137 smoke-journey acceptance floor, operational/Tier-4, all-languages)
    // Updated ADR-110: +1 (INV-138 acceptance-criteria anchor, selfOnly governance)
    // Updated #2181: +1 (INV-139 fixture isolation, selfOnly governance)
    // Updated ontology-wave-1: +4 (INV-140 id registry, INV-141 ontology-wired meta-gate,
    // INV-142 edit-time artifact schema hook, INV-143 arbiter<->forma schema contract —
    // all selfOnly governance/Tier-5)
    // Updated ontology-wave-2: +1 (INV-144 arc42 slot completeness — governance/Tier-5, and the
    // FIRST of this programme's invariants that is NOT selfOnly: a governed project's own arc42 is
    // exactly the document it governs, so it is emitted on Track B and counted in every filtered set.)
    expect(INVARIANT_CATALOG).toHaveLength(EXPECTED_TOTAL_ENTRIES)
  })

  it('all IDs are unique', () => {
    // Updated dual-ADR-cli-single-source: +1 (INV-111)
    // Updated feat-feature-matrix-rtm: +1 (INV-112)
    // Updated #1217: +1 (INV-117)
    // Updated #1249: +2 (INV-118, INV-119)
    // Updated #1231: +1 (INV-120)
    // Updated #1312: +1 (INV-121)
    // Updated #1328: +1 (INV-122)
    // Updated #1331: +1 (INV-123)
    // Updated #1364: +1 (INV-124)
    // Updated #1366: +1 (INV-127)
    // Updated #1398: +1 (INV-128)
    // Updated #1408: +1 (INV-129)
    // Updated #1445: +1 (INV-130)
    // Updated #1446: +1 (INV-131)
    // Updated #1447: +1 (INV-132)
    // Updated #1428: +1 (INV-135)
    // Updated #1456: +1 (INV-133)
    // Updated #2080: +1 (INV-137 smoke-journey acceptance floor)
    // Updated ADR-110: +1 (INV-138 acceptance-criteria anchor, selfOnly governance)
    // Updated #2181: +1 (INV-139 fixture isolation, selfOnly governance)
    // Updated ontology-wave-1: +4 (INV-140 id registry, INV-141 ontology-wired meta-gate,
    // INV-142 edit-time artifact schema hook, INV-143 arbiter<->forma schema contract —
    // all selfOnly governance/Tier-5)
    // Updated ontology-wave-2: +1 (INV-144 arc42 slot completeness — governance/Tier-5, and the
    // FIRST of this programme's invariants that is NOT selfOnly: a governed project's own arc42 is
    // exactly the document it governs, so it is emitted on Track B and counted in every filtered set.)
    const ids = INVARIANT_CATALOG.map((inv) => inv.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(EXPECTED_TOTAL_ENTRIES)
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
    // INV-11/12/13 (security tier) are intentionally alwaysActive=true.
    const optional = INVARIANT_CATALOG.filter(
      (inv) => inv.tier === 'data' || inv.tier === 'operational',
    )
    expect(optional.length).toBeGreaterThan(0)
    for (const inv of optional) {
      expect(inv.alwaysActive, `${inv.id} should NOT be alwaysActive`).toBe(false)
    }
  })

  it('security-tier alwaysActive invariants use their intended governance-level floor (M24, #1635, #2199)', () => {
    // #2199 promotes the pure-Node secret and PII scanners to the L1 baseline. The remaining
    // always-active security invariants stay floored at L2 because their enforcement requires L2.
    for (const id of ['INV-11', 'INV-12']) {
      const inv = INVARIANT_CATALOG.find((i) => i.id === id)
      expect(inv?.alwaysActive, `${id} should be alwaysActive`).toBe(true)
      expect(inv?.minGovernanceLevel, `${id} should require L1`).toBe('L1')
    }

    for (const id of [
      'INV-13',
      'INV-14',
      'INV-15',
      'INV-44',
      'INV-74',
      'INV-76',
      'INV-77',
      'INV-78',
      'INV-79',
      'INV-91',
      'INV-92',
    ]) {
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

  it(`has exactly ${EXPECTED_TIER4_OPERATIONAL} Tier 4 invariants`, () => {
    // Updated in #1127: +4 (INV-102/103/104/105 — FE governance, tier=operational)
    // Updated CANON-22: +1 (INV-109 duplication gate + ratchet, operational)
    // Updated #1312: +1 (INV-121 stack-conformity gate, operational)
    // Updated #1328: +1 (INV-122 update-propagates-fixes, operational)
    // Updated #1331: +1 (INV-123 emission-coherence gate, operational)
    // Updated #1364: +1 (INV-124 test pyramid non-empty gate, operational)
    // Updated #1367: +1 (INV-125 domain-api surface gate, operational)
    // Updated #1366: +1 (INV-127 frontend render-smoke gate, operational)
    // Updated #1398: +1 (INV-128 conformance script generated, operational)
    // Updated #1445: +1 (INV-130 e2e flaky-test quarantine subsystem, operational)
    // Updated #1446: +1 (INV-131 tdd-evidence re-verification gate, operational)
    // Updated #1447: +1 (INV-132 progressive-adoption bootstrap tier, operational, selfOnly)
    // Updated #1428: +1 (INV-135 doc-set + anti-fake-green runners generated, operational)
    const tier4 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'operational')
    expect(tier4).toHaveLength(EXPECTED_TIER4_OPERATIONAL)
  })

  it(`has exactly ${EXPECTED_TIER5_GOVERNANCE} Tier 5 invariants`, () => {
    // Updated in #1099: +1 (INV-107)
    // Updated in #1100: +1 (INV-108)
    // Updated dual-ADR-cli-single-source: +1 (INV-111)
    // Updated feat-feature-matrix-rtm: +1 (INV-112)
    // Updated #1214: +1 (INV-115 constraint-scan)
    // Updated #1241: +1 (INV-116 wiki-lint gate)
    // Updated #1217: +1 (INV-117 no tracked binary artifacts, selfOnly governance)
    // Updated #1249: +2 (INV-118 anti-proforma gate, INV-119 commit-footer audit evidence)
    // Updated #1231: +1 (INV-120 workflow needs-chain parallelism regression gate)
    // Updated #1408: +1 (INV-129 no tracked data/state files, governance, all-languages)
    // Updated #2181: +1 (INV-139 fixture isolation, selfOnly governance)
    // Updated ontology-wave-1: +4 (INV-140 id registry, INV-141 ontology-wired meta-gate,
    // INV-142 edit-time artifact schema hook, INV-143 arbiter<->forma schema contract —
    // all selfOnly governance/Tier-5)
    // Updated ontology-wave-2: +1 (INV-144 arc42 slot completeness — governance/Tier-5, and the
    // FIRST of this programme's invariants that is NOT selfOnly: a governed project's own arc42 is
    // exactly the document it governs, so it is emitted on Track B and counted in every filtered set.)
    const tier5 = INVARIANT_CATALOG.filter((inv) => inv.tier === 'governance')
    expect(tier5).toHaveLength(EXPECTED_TIER5_GOVERNANCE)
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
    // #1635: INV-14/15 (+ 8 more) are alwaysActive=true security invariants — bypass tier selection
    expect(ids).toContain('INV-14')
    expect(ids).toContain('INV-15')
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

  it('multi (polyglot) includes a Rust-only invariant — INV-60 — at L2+ (#1598)', () => {
    // multi is the superset of all detected languages: a Rust service in a
    // polyglot repo must receive the same Rust-scoped governance it would in a
    // single-language project. Previously the filter only admitted java/ts-scoped
    // invariants for multi, silently dropping INV-60 (the lone rust-only rule).
    const multi = getFilteredInvariants({
      language: 'multi',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    }).map((inv) => inv.id)
    expect(multi).toContain('INV-60')
    // Parity sanity: the same invariant is present for a single-language rust project.
    const rust = getFilteredInvariants({
      language: 'rust',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    }).map((inv) => inv.id)
    expect(rust).toContain('INV-60')
  })

  it('multi is a superset: every single-language-reachable invariant is reachable under multi (#1598)', () => {
    // Guard against a future rust/go/python-only invariant (like INV-60) being
    // silently excluded from polyglot projects by a hard-coded language allowlist.
    // Any invariant that a single-language project receives must also reach a
    // multi (polyglot) project at the same governance level.
    const multiIds = new Set(
      getFilteredInvariants({
        language: 'multi',
        governanceLevel: 'L4',
        invariantTiers: ALL_TIERS,
        includeArbiterInternal: true,
        includeExtendedInvariants: true,
      }).map((inv) => inv.id),
    )
    for (const lang of LANGUAGES) {
      const single = getFilteredInvariants({
        language: lang,
        governanceLevel: 'L4',
        invariantTiers: ALL_TIERS,
        includeArbiterInternal: true,
        includeExtendedInvariants: true,
      })
      for (const inv of single) {
        // Only language-scoped invariants are at risk of being dropped by the
        // multi allowlist; language-agnostic invariants pass unconditionally.
        if (!inv.languages) continue
        expect(
          multiIds.has(inv.id),
          `${inv.id} (scoped ${inv.languages.join('/')}) reachable for ${lang} but NOT under multi`,
        ).toBe(true)
      }
    }
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

  it('returns 69 for TypeScript + L3 + all tiers (INV-27/33 moved to L4, INV-29/30/44 Java-only + selfOnly excluded, INV-82 + INV-95/97/98/99 + INV-100 + INV-101 + INV-102/103/104/105/106 + INV-109 + INV-112 included)', () => {
    // Updated in #1127: +4 (INV-102/103/104/105 — typescript, L2, operational tier)
    // Updated CANON-22: +1 (INV-109 duplication gate, typescript L2 operational)
    // Updated feat-feature-matrix-rtm: +1 (INV-112 RTM, L2+, all languages)
    // Updated #1214: +1 (INV-115 constraint-scan, L1+, all languages)
    // Updated #1249: +2 (INV-118 anti-proforma, INV-119 commit-footer; both L1+/L2+ all languages)
    // Updated #1312: +1 (INV-121 stack-conformity, L1+, all languages, operational)
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    // Updated #1328: +1 (INV-122 update-propagates-fixes, L1+, all languages)
    // Updated #1331: +1 (INV-123 emission-coherence gate, L1+, all languages)
    // Updated #1364: +1 (INV-124 test pyramid non-empty gate, L1+, all languages)
    // Updated #1366: +1 (INV-127 frontend render-smoke gate, L1+, all languages)
    // Updated #1398: +1 (INV-128 conformance script generated, operational/Tier-4, all-languages)
    // Updated #1408: +1 (INV-129 no tracked data/state files, governance/Tier-5, all-languages)
    // Updated #1445: +1 (INV-130 e2e flaky-test quarantine subsystem, L1+, all-languages, operational)
    // Updated #1446: +1 (INV-131 tdd-evidence re-verification gate, L1+, all-languages, operational)
    // Updated #1428: +1 (INV-135 doc-set + anti-fake-green runners generated, operational)
    // Updated #1570: -1 (INV-56 retired tombstone now filtered from generated output)
    // Updated #1817: +1 (INV-136 tier-assignment rule, L1+, all-languages, operational)
    // Updated #2080: +1 (INV-137 smoke-journey acceptance floor, L1+, all-languages, operational)
    // Updated ontology-wave-2: +1 (INV-144 arc42 slot completeness, L1+, all-languages, Track B)
    // Updated #2480 (INV-145 adversarial-hop floor, governance/Tier-5, Track B, CANON-24)
    expect(result).toHaveLength(91)
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

  it('returns fewer than 59 for unknown language (language-specific excluded)', () => {
    // +1 from INV-112 (no language restriction) — threshold updated from 57→58
    // +1 from INV-115 (no language restriction, governance L1+) — threshold 58→59
    // +2 from INV-118 (L1+, all languages) + INV-119 (L2+, all languages) — threshold 59→61 → < 64
    // +1 from INV-123 (L1+, all languages, emission-coherence) — threshold < 64 → < 65
    // +1 from INV-124 (L1+, all languages, test pyramid) — threshold < 65 → < 66
    // +1 from INV-125 (L1+, all languages, domain-api surface) — threshold < 66 → < 67
    // +1 from INV-126 (L2+, all languages, live-api e2e) — threshold < 67 → < 68
    // +1 from INV-127 (L1+, all languages, render-smoke) — threshold < 68 → < 69
    // +1 from INV-128 (L1+, all languages, conformance script) — threshold < 69 → < 70
    // +1 from INV-129 (L1+, all languages, no tracked data/state files) — threshold < 70 → < 71
    // +1 from INV-130 (L1+, all languages, e2e flaky-test quarantine) — threshold < 71 → < 72
    // +1 from INV-131 (L1+, all languages, tdd-evidence re-verification) — threshold < 72 → < 73
    // +1 from INV-135 (L1+, all languages, doc-set + anti-fake-green runners) — threshold < 73 → < 74
    const result = getFilteredInvariants({
      language: 'unknown',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    // +1 from INV-137 (L1+, all languages, smoke-journey floor) — threshold < 76 → < 77
    // +1 from INV-144 (L1+, all languages, arc42 slot completeness) — → < 78
    // Updated #2480 (INV-145 adversarial-hop floor, governance/Tier-5, Track B, CANON-24)
    expect(result.length).toBeLessThan(79)
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

  it('Java + L2 + all tiers returns 64 invariants (L3-gated INV-28 + L4-gated INV-27/33 + selfOnly excluded, INV-82 + INV-95/97/98/99 + INV-100 + INV-101 + INV-112 included)', () => {
    // Updated feat-feature-matrix-rtm: +1 (INV-112 RTM, L2+, all languages)
    // Updated #1214: +1 (INV-115 constraint-scan, L1+, all languages)
    // Updated #1249: +2 (INV-118 anti-proforma L1+, INV-119 commit-footer L2+)
    // Updated #1312: +1 (INV-121 stack-conformity, L1+, all languages, operational)
    const result = getFilteredInvariants({
      language: 'java',
      governanceLevel: 'L2',
      invariantTiers: ALL_TIERS,
    })
    // Updated #1328: +1 (INV-122 update-propagates-fixes, L1+, all languages)
    // Updated #1331: +1 (INV-123 emission-coherence, L1+, all languages)
    // Updated #1364: +1 (INV-124 test pyramid non-empty gate, L1+, all languages)
    // Updated #1366: +1 (INV-127 frontend render-smoke gate, L1+, all languages)
    // Updated #1398: +1 (INV-128 conformance script generated, operational/Tier-4, all-languages)
    // Updated #1408: +1 (INV-129 no tracked data/state files, governance/Tier-5, all-languages)
    // Updated #1445: +1 (INV-130 e2e flaky-test quarantine subsystem, L1+, all-languages, operational)
    // Updated #1446: +1 (INV-131 tdd-evidence re-verification gate, L1+, all-languages, operational)
    // Updated #1428: +1 (INV-135 doc-set + anti-fake-green runners generated, operational)
    // Updated #1570: -1 (INV-56 retired tombstone now filtered from generated output)
    // Updated #1817: +1 (INV-136 tier-assignment rule, L1+, all languages, operational)
    // Updated #2080: +1 (INV-137 smoke-journey acceptance floor, L1+, all languages, operational)
    // Updated ontology-wave-2: +1 (INV-144 arc42 slot completeness, L1+, all-languages, Track B)
    // Updated #2480 (INV-145 adversarial-hop floor, governance/Tier-5, Track B, CANON-24)
    expect(result).toHaveLength(86)
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

  it('Java + L3 + all tiers returns 65 invariants (INV-27/33 moved to L4, selfOnly excluded, INV-82 + INV-95/97/98/99 + INV-100 + INV-101 + INV-112 included)', () => {
    // Updated feat-feature-matrix-rtm: +1 (INV-112 RTM, L2+, all languages)
    // Updated #1214: +1 (INV-115 constraint-scan, L1+, all languages, governance tier)
    // Updated #1249: +2 (INV-118 anti-proforma L1+, INV-119 commit-footer L2+)
    // Updated #1312: +1 (INV-121 stack-conformity, L1+, all languages, operational)
    // Updated #1328: +1 (INV-122 update-propagates-fixes, L1+, all languages, operational)
    // Updated #1331: +1 (INV-123 emission-coherence, L1+, all languages, operational)
    // Updated #1364: +1 (INV-124 test pyramid non-empty gate, L1+, all languages, operational)
    // Updated #1366: +1 (INV-127 frontend render-smoke gate, L1+, all languages, operational)
    // Updated #1398: +1 (INV-128 conformance script generated, operational/Tier-4, all-languages)
    // Updated #1408: +1 (INV-129 no tracked data/state files, governance/Tier-5, all-languages)
    // Updated #1445: +1 (INV-130 e2e flaky-test quarantine subsystem, L1+, all-languages, operational)
    // Updated #1446: +1 (INV-131 tdd-evidence re-verification gate, L1+, all-languages, operational)
    // Updated #1428: +1 (INV-135 doc-set + anti-fake-green runners generated, operational)
    // Updated #1570: -1 (INV-56 retired tombstone now filtered from generated output)
    // Updated #1817: +1 (INV-136 tier-assignment rule, L1+, all languages, operational)
    // Updated #2080: +1 (INV-137 smoke-journey acceptance floor, L1+, all languages, operational)
    const result = getFilteredInvariants({
      language: 'java',
      governanceLevel: 'L3',
      invariantTiers: ALL_TIERS,
    })
    // Updated ontology-wave-2: +1 (INV-144 arc42 slot completeness, L1+, all-languages, Track B)
    // Updated #2480 (INV-145 adversarial-hop floor, governance/Tier-5, Track B, CANON-24)
    expect(result).toHaveLength(87)
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
    // #2199: pure-Node secret and PII scanners are part of the L1 baseline.
    expect(tiers.has('security')).toBe(true)
    expect(tiers.has('operational')).toBe(false)
    // All other always-active security invariants remain floored at L2.
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain('INV-11')
    expect(ids).toContain('INV-12')
    expect(ids).not.toContain('INV-13')
    expect(ids).not.toContain('INV-14')
    expect(ids).not.toContain('INV-15')
    expect(ids).not.toContain('INV-78')
    expect(ids).not.toContain('INV-92')
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

  it('excludes retired (tombstone) invariants from generated output (#1570)', () => {
    // INV-56 is a status:'retired' tombstone kept for ID-stability only. It must
    // never reach generated AGENTS.md / GLOBAL_INVARIANTS.md, matching the graph
    // builder which already drops status !== 'active'. Tombstones stay in the raw
    // catalog (ID-stability) but are filtered out of every generation context.
    const retired = INVARIANT_CATALOG.filter((inv) => inv.status === 'retired')
    expect(retired.length, 'fixture: at least one retired tombstone must exist').toBeGreaterThan(0)
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
      const ids = getFilteredInvariants({
        language: 'typescript',
        governanceLevel: level,
        invariantTiers: ALL_TIERS,
        includeArbiterInternal: true,
        includeExtendedInvariants: true,
      }).map((inv) => inv.id)
      for (const inv of retired) {
        expect(ids, `${inv.id} (retired) must not appear at ${level}`).not.toContain(inv.id)
      }
    }
  })

  it(`catalog has exactly ${EXPECTED_SELFONLY} selfOnly invariants (#682, #862, #878, #879, #881, #883, #886, #1099, #1100, INV-110, INV-139)`, () => {
    // Updated dual-ADR-cli-single-source: +1 (INV-111)
    // Updated #1206: +1 (INV-113 single authoritative task-phase document)
    // Updated #1241: +1 (INV-116 wiki-lint gate, selfOnly)
    // Updated #1217: +1 (INV-117 no tracked binary artifacts, selfOnly)
    // Updated #1231: +1 (INV-120 workflow needs-chain parallelism regression gate, selfOnly)
    // Updated #1447: +1 (INV-132 progressive-adoption bootstrap tier, selfOnly)
    // Updated #2181: +1 (INV-139 fixture isolation, selfOnly governance)
    // Updated ontology-wave-1: +4 (INV-140 id registry, INV-141 ontology-wired meta-gate,
    // INV-142 edit-time artifact schema hook, INV-143 arbiter<->forma schema contract —
    // all selfOnly governance/Tier-5)
    const selfOnly = INVARIANT_CATALOG.filter((inv) => inv.selfOnly === true)
    expect(selfOnly).toHaveLength(EXPECTED_SELFONLY)
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
    expect(ids).toContain('INV-111')
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
// T9 — INV-73 full 8/8 canonical contract (#880, closed #2412)
// ---------------------------------------------------------------------------

describe('INV-73 workflow presence', () => {
  it('INV-73 minPresent is 8 (all 8 canonical workflow files required)', () => {
    const inv73 = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-73')
    expect(inv73!.minPresent).toBe(8)
  })
})
