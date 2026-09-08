// SPDX-License-Identifier: Apache-2.0
// #2429 — doc-asserting test for the tabletop scenario catalogue.
// A catalogue whose "docs the user would read" point at files that do not exist sends the
// tabletop agent chasing phantoms, which is the exact failure class a tabletop exists to
// find. So every cited arbiter-local path is stat'd here.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const CATALOGUE = 'docs/internal/METHOD/TABLETOP-SCENARIOS.md'

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

  // Field presence, id/slug shape and uniqueness, and the join to every evidence file are the
  // GATE's job as of #2480 wave 8 — scripts/check-tabletop-evidence.mjs reads this catalogue
  // directly. They used to live here as a hand-maintained EXPECTED_SLUGS list plus a field-name
  // array, which meant adding a scenario required editing a test constant, and which no governed
  // project ever received. What stays here is what the gate does not do: prove the cited paths
  // resolve in THIS repository, and prove the catalogue is indexed.

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
