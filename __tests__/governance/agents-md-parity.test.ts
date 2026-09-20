import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const catalogSrc = readFileSync(resolve('src/invariants/catalog.ts'), 'utf-8')
const agentsMd = readFileSync(resolve('AGENTS.md'), 'utf-8')
const invariantCatalogDoc = readFileSync(
  resolve('docs/internal/SYSTEM/INVARIANT-CATALOG.md'),
  'utf-8',
)

// Retired tombstones (status: 'retired') are kept in the catalog for ID-stability
// but are deliberately filtered out of generated/authored invariant docs (#1570), so
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

const DOCUMENTED_IDS = new Set(
  [...invariantCatalogDoc.matchAll(/\*\*(INV-\d+)[^*]*\*\*/g)].map((m) => m[1]),
)

describe('invariant catalog document parity (#180, #2738)', () => {
  it('every non-retired catalog INV-NN appears in the invariant catalog document', () => {
    const missing = CATALOG_IDS.filter((id) => !DOCUMENTED_IDS.has(id))
    expect(missing, `Missing from INVARIANT-CATALOG.md: ${missing.join(', ')}`).toEqual([])
  })

  it('at least 40 invariants exist in catalog', () => {
    expect(CATALOG_IDS.length).toBeGreaterThanOrEqual(40)
  })
})

// #2055: arbiter's root AGENTS.md is INTENTIONALLY hand-authored and thin. It is
// not reproducible from the shipped consumer template, so it must never be silently regenerated
// to the lossy generic version by `arbiter update` / the agents-md generator.
//
// Two independent guards, matching the two ways that regression can happen:
//  1. The `arbiter:preserve` marker (src/utils/fs.ts #1980) makes `writeFile`
//     refuse to overwrite the file — this PREVENTS an `arbiter update` clobber at
//     the source. This test fails if the marker is ever dropped.
//  2. The hand-authored sentinels below are strings the generic template provably
//     never emits — this CATCHES a manual regeneration that bypassed the marker.
describe('AGENTS.md self-authored preservation (#2055)', () => {
  it('carries the arbiter:preserve marker so `arbiter update` never regenerates it', () => {
    // Boolean form (not toContain) so a RED run does not dump the whole AGENTS.md
    // into the captured TDD-evidence log.
    expect(agentsMd.includes('arbiter:preserve')).toBe(true)
  })

  it('retains the hand-authored entry contract', () => {
    expect(agentsMd).toContain('doc_version:')
    expect(agentsMd).toContain('INVARIANT-CATALOG.md')
    expect(agentsMd.split('\n').length).toBeLessThanOrEqual(150)
    expect(invariantCatalogDoc).toContain('## Process Canon')
  })
})
