// SPDX-License-Identifier: Apache-2.0
// Public API surface test (#598): verifies barrel re-exports for @arbiter/cli/invariants
// and @arbiter/cli/compatibility. Tests import from source barrels directly.
import { describe, it, expect } from 'vitest'

describe('@arbiter/cli/invariants barrel', () => {
  it('exports INVARIANT_CATALOG as a non-empty array', async () => {
    const { INVARIANT_CATALOG } = await import('../src/invariants/index.js')
    expect(Array.isArray(INVARIANT_CATALOG)).toBe(true)
    expect(INVARIANT_CATALOG.length).toBeGreaterThan(0)
  })

  it('exports all runtime functions', async () => {
    const mod = await import('../src/invariants/index.js')
    expect(mod).toHaveProperty('INVARIANT_CATALOG')
    expect(mod).toHaveProperty('getFilteredInvariants')
    expect(mod).toHaveProperty('getInvariantsByTier')
    expect(mod).toHaveProperty('presetToTiers')
    expect(mod).toHaveProperty('defaultPresetForLevel')
    expect(typeof mod.getFilteredInvariants).toBe('function')
    expect(typeof mod.getInvariantsByTier).toBe('function')
    expect(typeof mod.presetToTiers).toBe('function')
    expect(typeof mod.defaultPresetForLevel).toBe('function')
  })

  it('does not export internal modules (no surplus exports)', async () => {
    const mod = await import('../src/invariants/index.js')
    const keys = Object.keys(mod)
    const allowed = new Set([
      'INVARIANT_CATALOG',
      'getFilteredInvariants',
      'getInvariantsByTier',
      'presetToTiers',
      'defaultPresetForLevel',
    ])
    const surplus = keys.filter((k) => !allowed.has(k))
    expect(surplus).toHaveLength(0)
  })
})

describe('@arbiter/cli/compatibility barrel', () => {
  it('exports runProbes function', async () => {
    const mod = await import('../src/compatibility/index.js')
    expect(mod).toHaveProperty('runProbes')
    expect(typeof mod.runProbes).toBe('function')
  })

  it('exports validateMatrix function', async () => {
    const mod = await import('../src/compatibility/index.js')
    expect(mod).toHaveProperty('validateMatrix')
    expect(typeof mod.validateMatrix).toBe('function')
  })

  it('exports skills-matrix functions (#556)', async () => {
    const mod = await import('../src/compatibility/index.js')
    expect(mod).toHaveProperty('loadSkillsMatrix')
    expect(mod).toHaveProperty('validateSkillsMatrix')
    expect(mod).toHaveProperty('getSkillsMatrixEntries')
    expect(typeof mod.loadSkillsMatrix).toBe('function')
    expect(typeof mod.validateSkillsMatrix).toBe('function')
    expect(typeof mod.getSkillsMatrixEntries).toBe('function')
  })

  it('does not export internal modules (no surplus exports)', async () => {
    const mod = await import('../src/compatibility/index.js')
    const keys = Object.keys(mod)
    const allowed = new Set([
      'runProbes',
      'validateMatrix',
      'loadSkillsMatrix',
      'validateSkillsMatrix',
      'getSkillsMatrixEntries',
    ])
    const surplus = keys.filter((k) => !allowed.has(k))
    expect(surplus).toHaveLength(0)
  })
})
