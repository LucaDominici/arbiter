// SPDX-License-Identifier: Apache-2.0
// #2429 — doc-asserting test for the tabletop scenario catalogue.
// A catalogue whose "docs the user would read" point at files that do not exist sends the
// tabletop agent chasing phantoms, which is the exact failure class a tabletop exists to
// find. So every cited arbiter-local path is stat'd here.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const CATALOGUE = 'docs/internal/METHOD/TABLETOP-SCENARIOS.md'

const EXPECTED_SLUGS = [
  'greenfield-init-ts',
  'brownfield-update-go',
  'ship-one-xs-issue',
  'drain-wave-of-four',
  'pr-red-and-recover',
  'consumer-upgrade-delta',
]

const REQUIRED_FIELDS = [
  '**Slug:**',
  '**Persona:**',
  '**Starting state:**',
  '**Goal:**',
  '**Docs the user would read:**',
  '**Executable probes:**',
  '**Exit criterion:**',
]

function catalogue(): string {
  return readFileSync(CATALOGUE, 'utf-8')
}

/** The `## N. …` scenario blocks, in document order. */
function scenarioBlocks(text: string): string[] {
  return text
    .split(/^## (?=\d+\. )/m)
    .slice(1)
    .map((b) => `## ${b}`)
}

describe('tabletop scenario catalogue (#2429)', () => {
  it('exists with the repo frontmatter convention', () => {
    expect(existsSync(CATALOGUE)).toBe(true)
    const text = catalogue()
    expect(text.startsWith('---\n')).toBe(true)
    for (const key of ['title:', 'doc_version:', 'status:', 'last_review:', 'tags:']) {
      expect(text).toContain(key)
    }
  })

  it('declares exactly the six seeded scenarios', () => {
    const blocks = scenarioBlocks(catalogue())
    expect(blocks).toHaveLength(6)
    const slugs = blocks.map((b) => /\*\*Slug:\*\*\s*`([^`]+)`/.exec(b)?.[1])
    expect(slugs).toEqual(EXPECTED_SLUGS)
  })

  it('gives every scenario all seven catalogue fields', () => {
    for (const block of scenarioBlocks(catalogue())) {
      const heading = block.split('\n')[0]
      const missing = REQUIRED_FIELDS.filter((f) => !block.includes(f))
      expect(missing, `${heading} is missing ${missing.join(', ')}`).toEqual([])
    }
  })

  it('cites only arbiter-local doc paths that actually exist', () => {
    let cited = 0
    for (const block of scenarioBlocks(catalogue())) {
      const line = /\*\*Docs the user would read:\*\*(.*)/.exec(block)?.[1] ?? ''
      const paths = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])
      expect(paths.length, `${block.split('\n')[0]} cites no docs`).toBeGreaterThan(0)
      for (const p of paths) {
        cited++
        expect(existsSync(p), `${CATALOGUE} cites a non-existent path: ${p}`).toBe(true)
      }
    }
    expect(cited).toBeGreaterThanOrEqual(6)
  })

  it('is indexed in docs/INDEX.md', () => {
    expect(readFileSync('docs/INDEX.md', 'utf-8')).toContain('METHOD/TABLETOP-SCENARIOS.md')
  })
})
