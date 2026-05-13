// Tests for #349 — INV-61 (a11y critical violations are HARD-fail at L2)
// must exist in the catalog and be mirrored in AGENTS.md §Invariants (CANON-08/09).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INVARIANT_CATALOG as invariants } from '../../src/invariants/catalog.js'

describe('INV-61 — a11y critical violations HARD-fail at L2 (#349)', () => {
  it('is registered in the invariant catalog', () => {
    const inv = invariants.find((i) => i.id === 'INV-61')
    expect(inv).toBeDefined()
  })

  it('targets typescript at minimum (matrix proven cell)', () => {
    const inv = invariants.find((i) => i.id === 'INV-61')
    expect(inv?.languages).toBeDefined()
    expect(inv?.languages).toContain('typescript')
  })

  it('mentions axe-core or critical in description', () => {
    const inv = invariants.find((i) => i.id === 'INV-61')
    expect(inv?.description).toMatch(/axe-core|critical/i)
  })

  it('is mirrored in AGENTS.md §Invariants', () => {
    const agents = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf-8')
    expect(agents).toMatch(/\*\*INV-61:\*\*/)
  })
})
