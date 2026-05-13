// Tests for #349 — `a11y` category must exist in cross-language-matrix.json
// with typescript proven (axe-core/playwright) and python beta
// (axe-playwright-python). CANON-02/CANON-08.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MATRIX_PATH = join(process.cwd(), 'src', 'compatibility', 'cross-language-matrix.json')

interface MatrixCell {
  tool: string
  maturity: 'proven' | 'beta' | 'unsafe' | 'unavailable'
  reason: string
}

type MatrixRow = Record<string, MatrixCell>

describe('cross-language-matrix.json — a11y row (#349, CANON-02/08)', () => {
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf-8')) as Record<
    string,
    MatrixRow | string
  >

  it('has an a11y row', () => {
    expect(matrix.a11y).toBeDefined()
    expect(typeof matrix.a11y).toBe('object')
  })

  it('marks typescript axe-core/playwright as proven', () => {
    const row = matrix.a11y as MatrixRow
    expect(row.typescript).toBeDefined()
    expect(row.typescript.tool).toContain('axe-core')
    expect(row.typescript.maturity).toBe('proven')
  })

  it('marks python axe-playwright-python as beta', () => {
    const row = matrix.a11y as MatrixRow
    expect(row.python).toBeDefined()
    expect(row.python.maturity).toBe('beta')
  })

  it('marks CLI languages (rust, go) as unavailable', () => {
    const row = matrix.a11y as MatrixRow
    expect(row.rust?.maturity).toBe('unavailable')
    expect(row.go?.maturity).toBe('unavailable')
  })
})
