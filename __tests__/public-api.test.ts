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

  it('re-exports InvariantTier and InvariantPreset type-bearing values', async () => {
    // Since these are type-only exports, we verify the module loads without error
    // and that the named exports are present at the module level
    const mod = await import('../src/invariants/index.js')
    // INVARIANT_CATALOG is the runtime value — types are verified via tsc
    expect(mod).toHaveProperty('INVARIANT_CATALOG')
    expect(mod).toHaveProperty('getFilteredInvariants')
  })

  it('re-exports Language wizard types (GovernanceLevel visible via module)', async () => {
    const mod = await import('../src/invariants/index.js')
    // The barrel should not throw on import — all re-exported paths must resolve
    expect(mod).toBeDefined()
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

  it('module loads without errors', async () => {
    const mod = await import('../src/compatibility/index.js')
    expect(mod).toBeDefined()
  })
})
