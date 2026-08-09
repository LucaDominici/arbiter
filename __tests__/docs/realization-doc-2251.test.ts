// SPDX-License-Identifier: Apache-2.0
// #2251 (wave-4 docs) — the lean-docs spec that seeded #2249 scopes a dedicated
// docs/architecture/realization.md: a thin pointer index (requirement-cluster → arc42 §5
// building-block id) followed by a numbered divergence log — only entries where implementation
// departed from the obvious reading of a requirement. Distinct from FEATURE_MATRIX.md (the RTM,
// requirement→code→test at fine grain) and arc42 §5 (structural decomposition) — neither is
// restated here. analysis.md §3 currently declares "realization = FEATURE_MATRIX.md" as the
// state of fact since realization.md doesn't exist yet; it must repoint once this file lands.
// Reads are lazy (inside each `it`) because the file is absent pre-fix.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REALIZATION = resolve('docs/architecture/realization.md')
const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

describe('#2251 — realization.md exists as a thin pointer index + divergence log', () => {
  it('docs/architecture/realization.md exists and is non-empty', () => {
    expect(existsSync(REALIZATION)).toBe(true)
    expect(read(REALIZATION).length).toBeGreaterThan(0)
  })

  it('is a thin doc — at most 60 lines', () => {
    const lines = read(REALIZATION).split('\n')
    expect(lines.length).toBeLessThanOrEqual(60)
  })

  it('has compliant frontmatter', () => {
    const doc = read(REALIZATION)
    expect(doc).toMatch(/^---\n/)
    for (const key of [
      'title:',
      'doc_version:',
      'status:',
      'last_review:',
      'owner:',
      'canonical_id:',
      'tags:',
      'related:',
    ]) {
      expect(doc).toContain(key)
    }
  })

  it('has a pointer index section and a divergence log section', () => {
    const doc = read(REALIZATION)
    expect(doc).toMatch(/^## Pointer Index/m)
    expect(doc).toMatch(/^## Divergence Log/m)
  })

  it('does not restate FEATURE_MATRIX as the realization doc (RTM stays FEATURE_MATRIX.md)', () => {
    expect(read(REALIZATION)).not.toMatch(/^\|.*Requirement ID.*Description.*Status/m)
  })

  it('analysis.md §3 Doc-role map links its Realization row at realization.md', () => {
    const analysis = read('docs/architecture/analysis.md')
    expect(analysis).toContain('](realization.md)')
  })
})
