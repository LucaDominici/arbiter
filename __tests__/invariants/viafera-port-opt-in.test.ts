// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import { getFilteredInvariants } from '../../src/invariants/filter.js'
import { validateConfig, DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

const VIAFERA_IDS = [
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

describe('viafera-port opt-in invariants', () => {
  it('catalog has exactly 71 entries after adding viafera-port set', () => {
    expect(INVARIANT_CATALOG).toHaveLength(71)
  })

  it('all 10 viafera-port IDs exist in catalog with optInGroup = viafera-port', () => {
    for (const id of VIAFERA_IDS) {
      const inv = INVARIANT_CATALOG.find((i) => i.id === id)
      expect(inv, `${id} must exist in catalog`).toBeDefined()
      expect(inv?.optInGroup, `${id} must have optInGroup`).toBe('viafera-port')
    }
  })

  it('default filter (includeViaferaPort not set) excludes all viafera-port invariants', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ['architectural', 'data', 'security', 'operational', 'governance'],
    })
    const ids = result.map((inv) => inv.id)
    for (const id of VIAFERA_IDS) {
      expect(ids, `${id} must be excluded by default filter`).not.toContain(id)
    }
  })

  it('includeViaferaPort: true includes all 10 viafera-port invariants', () => {
    const result = getFilteredInvariants({
      language: 'typescript',
      governanceLevel: 'L3',
      invariantTiers: ['architectural', 'data', 'security', 'operational', 'governance'],
      includeViaferaPort: true,
    })
    const ids = result.map((inv) => inv.id)
    for (const id of VIAFERA_IDS) {
      expect(ids, `${id} must be included when includeViaferaPort is true`).toContain(id)
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
