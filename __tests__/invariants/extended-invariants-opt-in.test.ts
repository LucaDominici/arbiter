// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import { getFilteredInvariants } from '../../src/invariants/filter.js'
import { validateConfig, DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

const EXTENDED_IDS = [
  'INV-62',
  'INV-63',
  'INV-64',
  'INV-65',
  'INV-66',
  'INV-67',
  'INV-68',
  'INV-69',
  'INV-70',
  'INV-71',
]

describe('extended opt-in invariants', () => {
  it('catalog has exactly 142 entries after adding extended set, INV-82, INV-94, INV-96, INV-95/97/98/99, INV-100, INV-101, INV-102/103/104/105, INV-107, INV-108, INV-109, INV-112, and INV-139', () => {
    // Updated in #1099: +1 (INV-107 ADR SSOT integrity)
    // Updated in #1100: +1 (INV-108 SSOT core set exhaustiveness)
    // Updated CANON-22: +1 (INV-109 duplication gate + ratchet)
    // Updated dual-ADR-cli-single-source: +1 (INV-111 CLI ref parity)
    // Updated feat-feature-matrix-rtm: +1 (INV-112 RTM/FEATURE_MATRIX required at L2+)
    // Updated #1206: +1 (INV-113 single authoritative task-phase document)
    // Updated #1214: +1 (INV-115 free-text governance prohibition scanner)
    // Updated #1241: +1 (INV-116 wiki-lint gate, selfOnly governance)
    // Updated #1217: +1 (INV-117 no tracked binary artifacts, selfOnly governance)
    // Updated #1249: +2 (INV-118 anti-proforma gate, INV-119 commit-footer audit evidence)
    // Updated #1231: +1 (INV-120 workflow needs-chain parallelism regression gate, selfOnly)
    // Note #1244: INV-56 retired via tombstone (status:'retired') — still counted.
    // Updated #1312: +1 (INV-121 stack-conformity gate, operational/Tier-4)
    // Updated #1328: +1 (INV-122 update-propagates-fixes, operational/Tier-4)
    // Updated #1331: +1 (INV-123 emission-coherence gate, operational/Tier-4)
    // Updated #1364: +1 (INV-124 test pyramid non-empty gate, operational/Tier-4)
    // Updated #1365: +1 (INV-126 live-API e2e gate, operational/Tier-4, L2+)
    // Updated #1366: +1 (INV-127 frontend render-smoke gate, operational/Tier-4)
    // Updated #1398: +1 (INV-128 conformance script generated, operational/Tier-4)
    // Updated #1408: +1 (INV-129 no tracked data/state files, governance/Tier-5)
    // Updated #1445: +1 (INV-130 e2e flaky-test quarantine subsystem, operational/Tier-4)
    // Updated #1446: +1 (INV-131 tdd-evidence re-verification gate, operational/Tier-4)
    // Updated #1447: +1 (INV-132 progressive-adoption bootstrap tier, operational/Tier-4, selfOnly)
    // Updated #1428: +1 (INV-135 doc-set + anti-fake-green runners generated, operational)
    // Updated #1817: +1 (INV-136 tier-assignment rule, operational)
    // Updated #2080: +1 (INV-141 smoke-journey acceptance floor, operational)
    // Updated ADR-110: +1 (INV-138 acceptance-criteria anchor, selfOnly governance)
    // Updated #2181: +1 (INV-139 fixture isolation, selfOnly governance)
    // Updated ontology-wave-2: +1 (INV-144 arc42 slot completeness, governance/Tier-5, Track B)
    expect(INVARIANT_CATALOG).toHaveLength(142)
  })

  it('all 10 extended IDs exist in catalog with optInGroup = extended', () => {
    for (const id of EXTENDED_IDS) {
      const inv = INVARIANT_CATALOG.find((i) => i.id === id)
      expect(inv, `${id} must exist in catalog`).toBeDefined()
      expect(inv?.optInGroup, `${id} must have optInGroup`).toBe('extended')
    }
  })

  it('default filter (includeExtendedInvariants not set) excludes all extended invariants', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ['architectural', 'data', 'security', 'operational', 'governance'],
    })
    const ids = result.map((inv) => inv.id)
    for (const id of EXTENDED_IDS) {
      expect(ids, `${id} must be excluded by default filter`).not.toContain(id)
    }
  })

  it('includeExtendedInvariants: true includes all 10 extended invariants', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ['architectural', 'data', 'security', 'operational', 'governance'],
      includeExtendedInvariants: true,
    })
    const ids = result.map((inv) => inv.id)
    for (const id of EXTENDED_IDS) {
      expect(ids, `${id} must be included when includeExtendedInvariants is true`).toContain(id)
    }
  })
})

describe('GovernanceConfig schema validation', () => {
  const BASE_CONFIG = {
    version: '1.0.0',
    tools: ['claude'],
    governanceLevel: 'L1',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: false,
    },
    thresholds: DEFAULT_THRESHOLDS.L1,
  }

  it('accepts absent governance object', () => {
    const result = validateConfig(BASE_CONFIG)
    expect(result.ok).toBe(true)
  })

  it('accepts governance.invariants_catalog = extended', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: { invariants_catalog: 'extended' },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts governance.invariants_catalog = core', () => {
    const result = validateConfig({ ...BASE_CONFIG, governance: { invariants_catalog: 'core' } })
    expect(result.ok).toBe(true)
  })

  it('rejects unknown governance.invariants_catalog value', () => {
    const result = validateConfig({ ...BASE_CONFIG, governance: { invariants_catalog: 'all' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('invariants_catalog'))).toBe(true)
  })

  it('rejects non-object governance', () => {
    const result = validateConfig({ ...BASE_CONFIG, governance: 'extended' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('governance'))).toBe(true)
  })
})
