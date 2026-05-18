// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { normalizeMatrixCell } from '../../src/kit/schema.js'

const ROOT = resolve(__dirname, '../..')

// ─── Unit cases ───────────────────────────────────────────────────────────────

describe('normalizeMatrixCell', () => {
  it('splits plus-separated tools', () => {
    expect(normalizeMatrixCell('checkstyle+pmd+spotbugs+spotless')).toEqual([
      'checkstyle',
      'pmd',
      'spotbugs',
      'spotless',
    ])
  })

  it('splits slash-separated tools (vitest/c8)', () => {
    expect(normalizeMatrixCell('vitest/c8')).toEqual(['vitest', 'c8'])
  })

  it('splits space-slash-space separated', () => {
    const result = normalizeMatrixCell('Playwright / pytest-playwright')
    expect(result).toContain('Playwright')
    expect(result).toContain('pytest-playwright')
  })

  it('preserves @cucumber/cucumber as single token', () => {
    expect(normalizeMatrixCell('@cucumber/cucumber')).toEqual(['@cucumber/cucumber'])
  })

  it('returns empty array for N/A', () => {
    expect(normalizeMatrixCell('N/A')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(normalizeMatrixCell('')).toEqual([])
  })

  it('handles single tool (no separator)', () => {
    expect(normalizeMatrixCell('pitest')).toEqual(['pitest'])
  })
})

// ─── Real matrix: every live cell tokenizes without error ─────────────────────

describe('normalizeMatrixCell — real matrix cells', () => {
  const matrix: Record<string, Record<string, { tool: string }>> = JSON.parse(
    readFileSync(join(ROOT, 'src/compatibility/cross-language-matrix.json'), 'utf-8'),
  )

  const STACKS = ['java', 'typescript', 'python', 'go', 'rust']

  for (const [cat, stackMap] of Object.entries(matrix)) {
    if (cat.startsWith('_')) continue
    for (const stack of STACKS) {
      const cell = (stackMap as Record<string, { tool: string } | undefined>)[stack]
      if (cell === undefined) continue
      const tool = typeof cell === 'object' ? cell.tool : cell
      it(`${cat}.${stack} = "${tool}" tokenizes`, () => {
        expect(() => normalizeMatrixCell(tool)).not.toThrow()
        // N/A is valid (returns [])
        // Non-N/A must produce at least one token
        if (tool !== 'N/A') {
          expect(normalizeMatrixCell(tool).length).toBeGreaterThan(0)
        }
      })
    }
  }
})
