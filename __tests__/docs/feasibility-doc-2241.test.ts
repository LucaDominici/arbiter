// SPDX-License-Identifier: Apache-2.0
// #2241 (wave-3 docs) — arbiter had no feasibility study: no record of alternatives
// rejected or why the stack/architecture was chosen. docs/architecture/feasibility.md
// adds a retroactive TELOS-lite record (Alternatives Considered, Technical/Economic/
// Operational Feasibility, Go/No-Go) citing the founding ADRs, and arc42.md §1.4 points
// to it. Reads are lazy (inside each `it`) because the file is empty/absent pre-fix.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FEASIBILITY = resolve('docs/architecture/feasibility.md')
const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

describe('#2241 — feasibility.md exists and is TELOS-complete', () => {
  it('docs/architecture/feasibility.md exists and is non-empty', () => {
    expect(existsSync(FEASIBILITY)).toBe(true)
    expect(read(FEASIBILITY).length).toBeGreaterThan(0)
  })

  it('is a retroactive record, not a design doc — at most 120 lines', () => {
    const lines = read(FEASIBILITY).split('\n')
    expect(lines.length).toBeLessThanOrEqual(120)
  })

  it('has compliant frontmatter', () => {
    const doc = read(FEASIBILITY)
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

  it('contains the TELOS sections: Alternatives Considered, Technical/Economic/Operational Feasibility, Go/No-Go', () => {
    const doc = read(FEASIBILITY)
    expect(doc).toMatch(/^## Alternatives Considered/m)
    expect(doc).toMatch(/^## Technical Feasibility/m)
    expect(doc).toMatch(/^## Economic Feasibility/m)
    expect(doc).toMatch(/^## Operational Feasibility/m)
    expect(doc).toMatch(/^## Go\/No-Go Rationale/m)
  })

  it('cites ADR-001, ADR-006, ADR-010, ADR-020', () => {
    const doc = read(FEASIBILITY)
    expect(doc).toContain('ADR-001')
    expect(doc).toContain('ADR-006')
    expect(doc).toContain('ADR-010')
    expect(doc).toContain('ADR-020')
  })

  it('arc42.md carries the §1.4 feasibility pointer', () => {
    const arc = read('docs/architecture/arc42.md')
    expect(arc).toMatch(/### 1\.4 Feasibility/)
    expect(arc).toContain('feasibility.md')
  })
})
