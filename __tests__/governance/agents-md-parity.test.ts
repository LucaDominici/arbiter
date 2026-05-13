import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const catalogSrc = readFileSync(resolve('src/invariants/catalog.ts'), 'utf-8')
const agentsMd = readFileSync(resolve('AGENTS.md'), 'utf-8')

const CATALOG_IDS = [...catalogSrc.matchAll(/id:\s*['"]?(INV-\d+)['"]?/g)].map((m) => m[1])

const AGENTS_IDS = new Set([...agentsMd.matchAll(/\*\*(INV-\d+)[^*]*\*\*/g)].map((m) => m[1]))

describe('AGENTS.md catalog parity (#180)', () => {
  it('every catalog INV-NN appears in AGENTS.md §Invariants', () => {
    const missing = CATALOG_IDS.filter((id) => !AGENTS_IDS.has(id))
    expect(missing, `Missing from AGENTS.md: ${missing.join(', ')}`).toEqual([])
  })

  it('at least 40 invariants exist in catalog', () => {
    expect(CATALOG_IDS.length).toBeGreaterThanOrEqual(40)
  })
})
