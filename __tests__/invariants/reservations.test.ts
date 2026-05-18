// SPDX-License-Identifier: Apache-2.0
// Machine-guard for INV-82/83/84 reservation: none must appear as catalog id entries.
// If a parallel PR claims one of these IDs, this test fails before it can merge.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const catalogSource = readFileSync(join(ROOT, 'src/invariants/catalog.ts'), 'utf-8')

// Matches only actual catalog entries (id: 'INV-NNN') — not comments
const ID_PATTERN = /id:\s*'(INV-\d+)'/g

const catalogIds = new Set<string>()
for (const match of catalogSource.matchAll(ID_PATTERN)) {
  catalogIds.add(match[1])
}

const RESERVED = ['INV-82', 'INV-83', 'INV-84']

describe('INV reservation guard', () => {
  for (const id of RESERVED) {
    it(`${id} must not appear as a catalog entry (reserved for sibling epic)`, () => {
      expect(catalogIds.has(id)).toBe(false)
    })
  }
})
