import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { buildInvNodes, splitEnforcement } from '../../src/graph/builders/inv.js'
import { GraphStore } from '../../src/graph/store.js'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import type { Invariant } from '../../src/invariants/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'graph')

function loadFixture(name: string): Invariant[] {
  const raw = readFileSync(join(FIXTURES_DIR, name), 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('fixture is not an array')
  return parsed as Invariant[]
}

describe('splitEnforcement (#259)', () => {
  it('splits on semicolons only', () => {
    expect(splitEnforcement('a')).toEqual(['a'])
    expect(splitEnforcement('a; b')).toEqual(['a', 'b'])
    // commas are NOT separators
    expect(splitEnforcement('CI (Knip, ESLint)')).toEqual(['CI (Knip, ESLint)'])
  })

  it('trims whitespace and drops empties', () => {
    expect(splitEnforcement(' a ;  ;b')).toEqual(['a', 'b'])
  })

  it('deduplicates', () => {
    expect(splitEnforcement('a; a; b')).toEqual(['a', 'b'])
  })
})

describe('buildInvNodes (#259)', () => {
  it('emits INV nodes for the clean fixture', () => {
    const cat = loadFixture('catalog-clean.json')
    const store = buildInvNodes(cat)
    const invs = store.nodesByKind('INV').map((x) => x.id)
    expect(invs.sort()).toEqual(['INV-01', 'INV-04', 'INV-06'])
  })

  it('emits an enforces edge for each enforcement mechanism', () => {
    const cat = loadFixture('catalog-clean.json')
    const store = buildInvNodes(cat)
    const enforces = store.outgoing('INV-04', 'enforces')
    // INV-04 in fixture: "hook + CI (ESLint no-explicit-any); local gate: ..." → 2 mechanisms
    expect(enforces).toHaveLength(2)
  })

  it('emits a GATE node per distinct mechanism', () => {
    const cat = loadFixture('catalog-clean.json')
    const store = buildInvNodes(cat)
    const gates = store.nodesByKind('GATE').map((x) => x.id)
    expect(gates).toContain('GATE:CI (madge)')
    expect(gates).toContain('GATE:CI (Knip)')
  })

  it('INV with empty enforcement emits no outgoing edges (orphan)', () => {
    const cat = loadFixture('catalog-orphan.json')
    const store = buildInvNodes(cat)
    expect(store.outgoing('INV-99', 'enforces')).toHaveLength(0)
  })

  it('populates INV attrs (title, tier, alwaysActive)', () => {
    const cat = loadFixture('catalog-clean.json')
    const store = buildInvNodes(cat)
    const node = store.getNode('INV-01')
    expect(node?.attrs['title']).toBe('No circular dependencies between modules')
    expect(node?.attrs['tier']).toBe('architectural')
    expect(node?.attrs['alwaysActive']).toBe(true)
  })

  it('real INVARIANT_CATALOG produces a non-orphan graph', () => {
    const store = buildInvNodes(INVARIANT_CATALOG)
    const orphans = store
      .nodesByKind('INV')
      .filter((inv) => store.outgoing(inv.id, 'enforces').length === 0)
    expect(orphans).toEqual([])
  })

  it('accepts a pre-built store and adds onto it', () => {
    const store = new GraphStore()
    store.addNode({ id: 'PRE', kind: 'FILE', attrs: {} })
    buildInvNodes(loadFixture('catalog-clean.json'), store)
    expect(store.hasNode('PRE')).toBe(true)
    expect(store.hasNode('INV-01')).toBe(true)
  })
})
