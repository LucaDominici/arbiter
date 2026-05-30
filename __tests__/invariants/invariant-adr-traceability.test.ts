// SPDX-License-Identifier: Apache-2.0
// #1102: machine-checked catalog→ADR cross-reference. Every invariant that
// declares an `adr` must point at an ADR file that actually exists.
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'

const ADR_DIR = fileURLToPath(new URL('../../docs/ADR/', import.meta.url))

const withAdr = INVARIANT_CATALOG.filter((inv) => inv.adr !== undefined)

describe('invariant↔ADR traceability (#1102)', () => {
  it('at least one invariant declares an ADR reference', () => {
    expect(withAdr.length).toBeGreaterThan(0)
  })

  it.each(withAdr)('$id adr "$adr" is well-formed and resolves to an ADR file', (inv) => {
    expect(inv.adr).toMatch(/^ADR-\d{3}$/)
    const num = (inv.adr as string).slice(4)
    const matches = readdirSync(ADR_DIR).filter((f) => f.startsWith(`${num}-`) && f.endsWith('.md'))
    expect(
      matches.length,
      `expected exactly one docs/ADR/${num}-*.md for ${inv.id} (${inv.adr})`,
    ).toBe(1)
  })
})
