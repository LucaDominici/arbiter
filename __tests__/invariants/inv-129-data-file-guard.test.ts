// SPDX-License-Identifier: Apache-2.0
// RED phase (#1408): INV-129 "No tracked data/state files in the index" must
// exist as a dedicated invariant, selfOnly:false (downstream + self), enforced by
// the extended self gate + the generated downstream gate. INV-117 stays unchanged.
import { describe, it, expect } from 'vitest'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'

describe('INV-129 — data/state file guard (#1408)', () => {
  const inv = INVARIANT_CATALOG.find((i) => i.id === 'INV-129')

  it('is present in the catalog', () => {
    expect(inv).toBeDefined()
  })

  it('is downstream + self (selfOnly is not true)', () => {
    expect(inv?.selfOnly).not.toBe(true)
  })

  it('cites the extended self gate as its enforcement', () => {
    expect(inv?.enforcement).toContain('check-no-tracked-artifacts.mjs')
  })

  it('describes data/state files (sqlite/db), not just build artifacts', () => {
    const text = `${inv?.title} ${inv?.description}`.toLowerCase()
    expect(text).toContain('data')
    expect(inv?.description.toLowerCase()).toMatch(/sqlite|\.db|state/)
  })

  it('leaves INV-117 (selfOnly binary-build-artifact gate) unchanged', () => {
    const inv117 = INVARIANT_CATALOG.find((i) => i.id === 'INV-117')
    expect(inv117?.selfOnly).toBe(true)
    expect(inv117?.title).toBe('arbiter self-repo must not track binary build artifacts')
  })

  it('explains the three-way split (data files trip neither gitleaks nor pii-scan)', () => {
    const d = inv?.description.toLowerCase() ?? ''
    expect(d).toMatch(/gitleaks|pii/)
  })
})
