// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import type { Invariant } from '../../src/invariants/types.js'

describe('ID stability — retire-marker invariant (#610)', () => {
  it('every retired entry has retiredReason set', () => {
    const retired = INVARIANT_CATALOG.filter((inv) => inv.status === 'retired')
    for (const inv of retired) {
      expect(inv.retiredReason, `${inv.id} is retired but missing retiredReason`).toBeTruthy()
    }
  })

  it('no two active entries share an id prefix', () => {
    const active = INVARIANT_CATALOG.filter((inv) => inv.status !== 'retired')
    const ids = active.map((inv) => inv.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('status field is "active", "retired", or undefined (legacy)', () => {
    for (const inv of INVARIANT_CATALOG) {
      if (inv.status !== undefined) {
        expect(['active', 'retired'], `${inv.id} has unexpected status "${inv.status}"`).toContain(
          inv.status,
        )
      }
    }
  })

  it('redirectTo is only set on retired entries', () => {
    const nonRetired = INVARIANT_CATALOG.filter((inv) => inv.status !== 'retired')
    for (const inv of nonRetired) {
      expect(inv.redirectTo, `${inv.id} has redirectTo but is not retired`).toBeUndefined()
    }
  })

  it('Invariant type accepts all three optional retire fields', () => {
    // Compile-time check: construct a retired invariant and verify types accepted
    const retired: Invariant = {
      id: 'INV-TEST',
      tier: 'governance',
      title: 'Test retired invariant',
      description: 'Used to verify retire fields are typed correctly.',
      alwaysActive: false,
      status: 'retired',
      retiredReason: 'Superseded by INV-NEXT',
      redirectTo: 'INV-NEXT',
    }
    expect(retired.status).toBe('retired')
    expect(retired.retiredReason).toBeTruthy()
    expect(retired.redirectTo).toBe('INV-NEXT')
  })

  it('active entries have consistent id format INV-NN', () => {
    const active = INVARIANT_CATALOG.filter((inv) => inv.status !== 'retired')
    for (const inv of active) {
      expect(inv.id, `${inv.id} does not match INV-NN pattern`).toMatch(/^INV-\d{2,3}$/)
    }
  })
})
