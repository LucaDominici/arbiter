// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { getFilteredInvariants } from '../../src/invariants/filter.js'
import { validateConfig, DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import type { Invariant } from '../../src/invariants/types.js'

// #2035 — project-declared invariants (PROJ-NN namespace). These tests are the
// TDD RED for the filter-merge unit: `getFilteredInvariants` is the single
// merge point through which project invariants propagate to AGENTS.md,
// GLOBAL_INVARIANTS.md, the graph, explain, and the parity gate.
//
// The casts widen the current signature with the future `projectInvariants`
// field so the RED runs against the pre-feature code; the GREEN removes the
// need for them (they remain harmless).

const PROJ_01: Invariant = {
  id: 'PROJ-01',
  tier: 'governance',
  title: 'Tenancy isolation is a product contract',
  description:
    'Every tenant-scoped resource must carry owner_id and honor TripAccessContext (consumer GDPR product contract).',
  alwaysActive: true,
  enforcement: 'CI (constraint scan); code review',
}

const BASE_FILTER = {
  language: 'typescript',
  governanceLevel: 'L2' as const,
  invariantTiers: ['architectural', 'governance'],
}

type FilterOpts = Parameters<typeof getFilteredInvariants>[0]

describe('project invariants (PROJ-NN, #2035)', () => {
  it('merges declared projectInvariants into the filtered result (TC-1)', () => {
    const result = getFilteredInvariants({
      ...BASE_FILTER,
      projectInvariants: [PROJ_01],
    } as FilterOpts & { projectInvariants: Invariant[] })
    expect(result.map((inv) => inv.id)).toContain('PROJ-01')
  })

  it('keeps the merged result deterministic: catalog first, then project invariants (TC-1)', () => {
    const result = getFilteredInvariants({
      ...BASE_FILTER,
      projectInvariants: [PROJ_01],
    } as FilterOpts & { projectInvariants: Invariant[] })
    expect(result[result.length - 1]!.id).toBe('PROJ-01')
  })

  it('applies minGovernanceLevel to project invariants (TC-5 semantics)', () => {
    const result = getFilteredInvariants({
      ...BASE_FILTER,
      governanceLevel: 'L1' as const,
      projectInvariants: [{ ...PROJ_01, minGovernanceLevel: 'L2' as const }],
    } as FilterOpts & { projectInvariants: Invariant[] })
    expect(result.map((inv) => inv.id)).not.toContain('PROJ-01')
  })

  it('applies the extended opt-in gate to project invariants (TC-5 semantics)', () => {
    const result = getFilteredInvariants({
      ...BASE_FILTER,
      projectInvariants: [{ ...PROJ_01, optInGroup: 'extended' as const }],
    } as FilterOpts & { projectInvariants: Invariant[] })
    expect(result.map((inv) => inv.id)).not.toContain('PROJ-01')
  })

  it('does not drop project invariants on the tier filter (declared = wanted)', () => {
    // tier 'security' is not in the essential preset — a declared PROJ invariant
    // must still surface (the project explicitly declared it).
    const result = getFilteredInvariants({
      ...BASE_FILTER,
      invariantTiers: ['architectural', 'governance'],
      projectInvariants: [{ ...PROJ_01, tier: 'security' as const }],
    } as FilterOpts & { projectInvariants: Invariant[] })
    expect(result.map((inv) => inv.id)).toContain('PROJ-01')
  })
})

describe('GovernanceConfig projectInvariants schema validation (#2035)', () => {
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

  it('accepts a valid PROJ-NN project invariant (TC-1)', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: { projectInvariants: [PROJ_01] },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects an INV-prefixed project invariant id with a clear message (TC-3)', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: {
        projectInvariants: [
          { ...PROJ_01, id: 'INV-99' },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('INV-99'))).toBe(true)
  })

  it('rejects a malformed project invariant id (TC-3)', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: {
        projectInvariants: [
          { ...PROJ_01, id: 'project-one' },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('PROJ-'))).toBe(true)
  })

  it('rejects duplicate project invariant ids (TC-3)', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: { projectInvariants: [PROJ_01, { ...PROJ_01 }] },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('PROJ-01'))).toBe(true)
  })

  it('rejects a retired-status project invariant (TC-3)', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: {
        projectInvariants: [{ ...PROJ_01, status: 'retired' as const }],
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('retired'))).toBe(true)
  })

  it('rejects a project invariant missing required fields (TC-3)', () => {
    const result = validateConfig({
      ...BASE_CONFIG,
      governance: {
        projectInvariants: [
          { id: 'PROJ-02', title: 'incomplete' } as unknown as Invariant,
        ],
      },
    })
    expect(result.ok).toBe(false)
  })
})
