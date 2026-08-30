// SPDX-License-Identifier: Apache-2.0
// #2413: README's "Stack support" table hand-declared Supported/Experimental
// per language with no link back to src/compatibility/cross-language-matrix.json
// — the two drifted (e.g. Kotlin was entirely absent from the table). This
// pins README's declared tiers to a mechanically-computed rule so the table
// can't silently diverge from the matrix again: a language is Supported iff
// all of its required cells (static_analysis, coverage, architecture,
// security — the always-on L1/L2 baseline gates) are `proven`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const README_PATH = resolve('README.md')
const MATRIX_PATH = resolve('src/compatibility/cross-language-matrix.json')

const REQUIRED_CELLS = ['static_analysis', 'coverage', 'architecture', 'security'] as const

function computeTiers(): Record<string, 'Supported' | 'Experimental'> {
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf-8')) as Record<
    string,
    Record<string, { maturity: string }> | undefined
  >
  const languages = new Set<string>()
  for (const cell of REQUIRED_CELLS) {
    for (const lang of Object.keys(matrix[cell] ?? {})) languages.add(lang)
  }
  const tiers: Record<string, 'Supported' | 'Experimental'> = {}
  for (const lang of languages) {
    const allProven = REQUIRED_CELLS.every((cell) => matrix[cell]?.[lang]?.maturity === 'proven')
    tiers[lang] = allProven ? 'Supported' : 'Experimental'
  }
  return tiers
}

interface TableRow {
  displayName: string
  tier: string
}

/** Extract the Language/Status columns from README's stack-support table. */
function parseReadmeTable(readme: string): Record<string, TableRow> {
  const tableMatch = /\| Language\s*\|[\s\S]*?\n\n/.exec(readme)
  expect(tableMatch, 'README stack-support table not found').not.toBeNull()
  const rows: Record<string, TableRow> = {}
  for (const line of tableMatch![0].split('\n')) {
    const m = /^\|\s*(\S+)\s*\|.*\|\s*(Supported|Experimental)\s*\|$/.exec(line.trim())
    if (m) rows[m[1].toLowerCase()] = { displayName: m[1], tier: m[2] }
  }
  return rows
}

describe('README stack tiers match cross-language-matrix.json (#2413)', () => {
  const readme = readFileSync(README_PATH, 'utf-8')
  const computed = computeTiers()
  const declared = parseReadmeTable(readme)

  it('computes at least the six known languages from the matrix', () => {
    expect(Object.keys(computed).length).toBeGreaterThanOrEqual(6)
  })

  it('README declares a row for every language the matrix rule can classify', () => {
    for (const lang of Object.keys(computed)) {
      expect(declared[lang], `README table missing a row for "${lang}"`).toBeDefined()
    }
  })

  it('every declared table row matches the matrix-computed tier', () => {
    for (const [lang, row] of Object.entries(declared)) {
      expect(computed[lang], `README declares "${lang}" but the matrix has no entry`).toBeDefined()
      expect(
        row.tier,
        `README says ${lang}=${row.tier} but the matrix rule computes ${computed[lang]}`,
      ).toBe(computed[lang])
    }
  })

  it('the Supported/Experimental prose summary lines match the table', () => {
    const supported = Object.values(declared).filter((r) => r.tier === 'Supported')
    const experimental = Object.values(declared).filter((r) => r.tier === 'Experimental')
    for (const row of supported) {
      expect(
        readme,
        `"${row.displayName}" missing from the Supported: summary line`,
      ).toContain(row.displayName)
    }
    expect(
      experimental.length,
      'exactly one Experimental language expected today (Kotlin)',
    ).toBe(1)
    expect(
      readme,
      `"${experimental[0].displayName}" missing from the Experimental: summary line`,
    ).toContain(experimental[0].displayName)
  })

  it('the README states the tier rule (required cells) in prose near the table', () => {
    for (const cell of REQUIRED_CELLS) {
      expect(readme, `README tier rule prose missing required cell "${cell}"`).toContain(cell)
    }
  })
})
