// SPDX-License-Identifier: Apache-2.0
// #2249 (wave-3 docs) — arbiter had no verified as-is/current-state snapshot: no single
// doc answered "what's confirmed working right now, and what's the gap" without
// re-deriving or copying counts from prior audits. docs/architecture/analysis.md adds a
// links-not-restatement inventory (requirements corpus, real CLI/gate surface, doc-role
// map, known drift/gaps, verification status) citing the live SSOT files, and arc42.md
// §1.4 points to it. Reads are lazy (inside each `it`) because the file is empty/absent
// pre-fix.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ANALYSIS = resolve('docs/architecture/analysis.md')
const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

describe('#2249 — analysis.md exists and is a verified current-state snapshot', () => {
  it('docs/architecture/analysis.md exists and is non-empty', () => {
    expect(existsSync(ANALYSIS)).toBe(true)
    expect(read(ANALYSIS).length).toBeGreaterThan(0)
  })

  it('has compliant frontmatter', () => {
    const doc = read(ANALYSIS)
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

  it('contains the 5 sections: Requirements inventory, Real surface, Doc-role map, Known drift & gaps, Verification status', () => {
    const doc = read(ANALYSIS)
    expect(doc).toMatch(/^## 1\. Requirements inventory/m)
    expect(doc).toMatch(/^## 2\. Real surface/m)
    expect(doc).toMatch(/^## 3\. Doc-role map/m)
    expect(doc).toMatch(/^## 4\. Known drift & gaps/m)
    expect(doc).toMatch(/^## 5\. Verification status/m)
  })

  it('cites the SSOT pointers backing its counts (catalog.ts, .bloat-baseline.json)', () => {
    const doc = read(ANALYSIS)
    expect(doc).toContain('catalog.ts')
    expect(doc).toContain('.bloat-baseline.json')
  })

  it('references the gap issues filed/tracked by its Known drift & gaps register', () => {
    const doc = read(ANALYSIS)
    for (const issue of ['#2239', '#2244', '#2248', '#2250', '#2251', '#2252']) {
      expect(doc).toContain(issue)
    }
  })

  it('arc42.md carries the §1.4 analysis cross-link', () => {
    const arc = read('docs/architecture/arc42.md')
    expect(arc).toContain('analysis.md')
  })
})
