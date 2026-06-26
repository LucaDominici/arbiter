import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const catalogSrc = readFileSync(resolve('src/invariants/catalog.ts'), 'utf-8')
const agentsMd = readFileSync(resolve('AGENTS.md'), 'utf-8')

// Retired tombstones (status: 'retired') are kept in the catalog for ID-stability
// but are deliberately filtered out of generated/authored AGENTS.md (#1570), so
// they are not required to appear as live rows here.
const retiredIds = new Set<string>()
{
  const marks = [...catalogSrc.matchAll(/id:\s*['"]?(INV-\d+)['"]?/g)]
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index ?? 0
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? catalogSrc.length) : catalogSrc.length
    if (/status:\s*'retired'/.test(catalogSrc.slice(start, end))) retiredIds.add(marks[i][1])
  }
}

const CATALOG_IDS = [...catalogSrc.matchAll(/id:\s*['"]?(INV-\d+)['"]?/g)]
  .map((m) => m[1])
  .filter((id) => !retiredIds.has(id))

const AGENTS_IDS = new Set([...agentsMd.matchAll(/\*\*(INV-\d+)[^*]*\*\*/g)].map((m) => m[1]))

describe('AGENTS.md catalog parity (#180)', () => {
  it('every non-retired catalog INV-NN appears in AGENTS.md §Invariants', () => {
    const missing = CATALOG_IDS.filter((id) => !AGENTS_IDS.has(id))
    expect(missing, `Missing from AGENTS.md: ${missing.join(', ')}`).toEqual([])
  })

  it('at least 40 invariants exist in catalog', () => {
    expect(CATALOG_IDS.length).toBeGreaterThanOrEqual(40)
  })
})
