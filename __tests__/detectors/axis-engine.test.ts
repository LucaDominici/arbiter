// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { deriveAxisDefaults } from '../../src/detectors/axis.js'

// ── G1a unit 3 (#1317): databaseEngine ⇔ hasDatabase never diverge ────────────
describe('deriveAxisDefaults — databaseEngine derivation (#1317)', () => {
  it('legacy hasDatabase:true (no engine) ⇒ databaseEngine "postgresql"', () => {
    const d = deriveAxisDefaults({ hasDatabase: true }, 'backend-web-db')
    expect(d.databaseEngine).toBe('postgresql')
    expect(d.hasDatabase).toBe(true)
  })

  it('explicit databaseEngine:"sqlite" ⇒ hasDatabase true', () => {
    const d = deriveAxisDefaults({ databaseEngine: 'sqlite' }, 'library')
    expect(d.databaseEngine).toBe('sqlite')
    expect(d.hasDatabase).toBe(true)
  })

  it('databaseEngine:"none" ⇒ hasDatabase false (even on a db archetype)', () => {
    const d = deriveAxisDefaults({ databaseEngine: 'none' }, 'backend-web-db')
    expect(d.databaseEngine).toBe('none')
    expect(d.hasDatabase).toBe(false)
  })

  it('db archetype with nothing stored ⇒ hasDatabase true, engine postgresql', () => {
    const d = deriveAxisDefaults(null, 'backend-web-db')
    expect(d.hasDatabase).toBe(true)
    expect(d.databaseEngine).toBe('postgresql')
  })

  it('non-db archetype with nothing stored ⇒ hasDatabase false, engine none', () => {
    const d = deriveAxisDefaults(null, 'cli')
    expect(d.hasDatabase).toBe(false)
    expect(d.databaseEngine).toBe('none')
  })

  it('hasDatabase and databaseEngine never diverge (engine wins when explicit)', () => {
    // explicit engine overrides a contradictory legacy flag
    const d = deriveAxisDefaults({ hasDatabase: true, databaseEngine: 'none' }, 'backend-web-db')
    expect(d.databaseEngine).toBe('none')
    expect(d.hasDatabase).toBe(false)
  })
})
