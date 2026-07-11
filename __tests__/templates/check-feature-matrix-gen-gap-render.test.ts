// SPDX-License-Identifier: Apache-2.0
// Render tests for check-feature-matrix.mjs.ejs and gen-gap.mjs.ejs (#1887-B) —
// mirrors check-domain-api-surface-render.test.ts's structure.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'

const BASE_DATA = {
  projectName: 'test-project',
  governanceLevel: 'L2' as const,
}

describe('check-feature-matrix.mjs.ejs render tests', () => {
  it('renders without throwing', () => {
    const result = renderTemplate('scripts/check-feature-matrix.mjs.ejs', BASE_DATA)
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(100)
  })

  it('interpolates projectName', () => {
    const result = renderTemplate('scripts/check-feature-matrix.mjs.ejs', {
      ...BASE_DATA,
      projectName: 'my-project',
    })
    expect(result).toContain('my-project')
  })

  it('has no unrendered EJS markers', () => {
    const result = renderTemplate('scripts/check-feature-matrix.mjs.ejs', BASE_DATA)
    expect(result).not.toContain('<%')
    expect(result).not.toContain('%>')
  })

  it("points at docs/FEATURE_MATRIX.md (target path, not arbiter's own internal/PRODUCT path)", () => {
    const result = renderTemplate('scripts/check-feature-matrix.mjs.ejs', BASE_DATA)
    expect(result).toContain("MATRIX_PATH = resolve(ROOT, 'docs', 'FEATURE_MATRIX.md')")
    expect(result).not.toContain("'docs', 'internal', 'PRODUCT'")
  })

  it('has no KIT_CATALOG_PATH constant (no target-project equivalent)', () => {
    const result = renderTemplate('scripts/check-feature-matrix.mjs.ejs', BASE_DATA)
    expect(result).not.toContain('KIT_CATALOG_PATH')
  })

  it('contains exit 0/1/2 paths (INV-53 codes)', () => {
    const result = renderTemplate('scripts/check-feature-matrix.mjs.ejs', BASE_DATA)
    expect(result).toContain('process.exit(0)')
    expect(result).toContain('process.exit(1)')
    expect(result).toContain('process.exit(2)')
  })
})

describe('gen-gap.mjs.ejs render tests', () => {
  it('renders without throwing', () => {
    const result = renderTemplate('scripts/gen-gap.mjs.ejs', BASE_DATA)
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(100)
  })

  it('interpolates projectName', () => {
    const result = renderTemplate('scripts/gen-gap.mjs.ejs', {
      ...BASE_DATA,
      projectName: 'my-project',
    })
    expect(result).toContain('my-project')
  })

  it('has no unrendered EJS markers', () => {
    const result = renderTemplate('scripts/gen-gap.mjs.ejs', BASE_DATA)
    expect(result).not.toContain('<%')
    expect(result).not.toContain('%>')
  })

  it('points at docs/FEATURE_MATRIX.md and docs/GAP.md (target paths)', () => {
    const result = renderTemplate('scripts/gen-gap.mjs.ejs', BASE_DATA)
    expect(result).toContain("'docs', 'FEATURE_MATRIX.md'")
    expect(result).toContain("'docs', 'GAP.md'")
  })

  it('contains exit 0/1/2 paths (INV-53 codes)', () => {
    const result = renderTemplate('scripts/gen-gap.mjs.ejs', BASE_DATA)
    expect(result).toContain('process.exit(0)')
    expect(result).toContain('process.exit(1)')
    expect(result).toContain('process.exit(2)')
  })
})
