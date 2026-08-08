// SPDX-License-Identifier: Apache-2.0
// #2242 (wave-3 docs) — the RTM had no way to say WHAT KIND of proof a requirement
// needs (GAMP IQ/OQ/PQ style), REQ-017/018/019 hand-copied counts that drifted from
// their own SSOT (src/cli.ts, .bloat-baseline.json, src/invariants/catalog.ts), and
// the 46 Partial + 1 Missing rows had never been triaged true-gap vs accepted-partial.
// These assertions pin the verification_tier column, the SSOT-pointer rewrite, and the
// Gap Triage section with its 4 filed clusters (#2244-#2247).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const doc = readFileSync(resolve('docs/internal/PRODUCT/FEATURE_MATRIX.md'), 'utf-8')

function mainTableRows(md: string): string[] {
  const start = md.indexOf('<!-- FEATURE_MATRIX_START -->')
  const end = md.indexOf('<!-- FEATURE_MATRIX_END -->')
  const body = start !== -1 && end !== -1 ? md.slice(start, end) : ''
  return body.split('\n').filter((line) => line.startsWith('| REQ-'))
}

describe('#2242 — FEATURE_MATRIX.md carries a GAMP-style verification_tier', () => {
  it('the header row declares the verification_tier column', () => {
    expect(doc).toMatch(/^\|.*\bverification_tier\b.*\|$/m)
  })

  it('every data row in the main table carries a non-empty SCAFFOLD|GATE|E2E tier', () => {
    const rows = mainTableRows(doc)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const cells = row.split('|')
      const tier = cells[cells.length - 2]?.trim()
      expect(tier).toMatch(/^(SCAFFOLD|GATE|E2E)$/)
    }
  })

  it('Gap Triage section exists and references the 4 filed cluster issues', () => {
    expect(doc).toMatch(/^## Gap Triage/m)
    expect(doc).toContain('#2244')
    expect(doc).toContain('#2245')
    expect(doc).toContain('#2246')
    expect(doc).toContain('#2247')
  })

  it('REQ-017/018/019 carry SSOT pointers, not bare hand-copied counts', () => {
    expect(doc).not.toContain('34 registered commands')
    expect(doc).not.toContain('61 registered generators')
    expect(doc).not.toContain('110 invariants')
    expect(doc).toContain('src/cli.ts')
    expect(doc).toContain('.bloat-baseline.json')
    expect(doc).toContain('src/invariants/catalog.ts')
  })
})
