// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { deriveKit, KitOverlayCellSchema } from '../../src/kit/schema.js'
import type { KitCatalog, KitOverlay, KitCategoryMap } from '../../src/kit/schema.js'

const STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const

function minDim(overrides: Partial<KitCatalog[number]> = {}): KitCatalog[number] {
  return {
    id: 'N01',
    name: 'Test dim',
    tml: 'L1',
    gate: 'BLOCKING',
    categoryRef: 'test_cat',
    archetypeGating: { applies: [], excludes: [] },
    status: 'covered',
    ...overrides,
  }
}

const MATRIX_WITH_TOOL: Record<string, Record<string, { tool: string }>> = {
  test_cat: {
    java: { tool: 'junit5' },
    typescript: { tool: 'vitest' },
    python: { tool: 'pytest' },
    go: { tool: 'go test' },
    rust: { tool: 'cargo test' },
  },
}

const CATEGORY_MAP: KitCategoryMap = {
  test_cat: ['test_cat'],
}

describe('deriveKit', () => {
  it('uses matrix tool when no overlay', () => {
    const result = deriveKit([minDim()], {}, MATRIX_WITH_TOOL, CATEGORY_MAP)
    for (const stack of STACKS) {
      expect(result[0].perStack[stack].kind).toBe('tool')
    }
  })

  it('overlay overrides matrix', () => {
    const overlay: KitOverlay = {
      N01: {
        java: {
          kind: 'equivalent',
          arbiterSlot: 'coverage',
          reason: 'JaCoCo satisfies this requirement in the Java ecosystem for coverage reporting',
        },
      },
    }
    const result = deriveKit([minDim()], overlay, MATRIX_WITH_TOOL, CATEGORY_MAP)
    expect(result[0].perStack['java'].kind).toBe('equivalent')
    expect(result[0].perStack['typescript'].kind).toBe('tool')
  })

  it('produces gap when matrix has N/A', () => {
    const matrix = {
      test_cat: {
        java: { tool: 'junit5' },
        typescript: { tool: 'N/A' },
        python: { tool: 'N/A' },
        go: { tool: 'N/A' },
        rust: { tool: 'N/A' },
      },
    }
    const result = deriveKit([minDim()], {}, matrix, CATEGORY_MAP)
    expect(result[0].perStack['typescript'].kind).toBe('gap')
  })

  it('produces gap when category not in matrix', () => {
    const result = deriveKit([minDim({ categoryRef: 'unknown_cat' })], {}, MATRIX_WITH_TOOL, {
      unknown_cat: ['nonexistent_matrix_cat'],
    })
    for (const stack of STACKS) {
      expect(result[0].perStack[stack].kind).toBe('gap')
    }
  })

  it('produces gap when categoryRef has empty matrix mapping', () => {
    const result = deriveKit([minDim({ categoryRef: 'java_only_cat' })], {}, MATRIX_WITH_TOOL, {
      java_only_cat: [],
    })
    for (const stack of STACKS) {
      expect(result[0].perStack[stack].kind).toBe('gap')
    }
  })

  it('multiple dims derive independently', () => {
    const catalog: KitCatalog = [
      minDim({ id: 'N01', categoryRef: 'test_cat' }),
      minDim({ id: 'N02', categoryRef: 'unknown_cat' }),
    ]
    const result = deriveKit(catalog, {}, MATRIX_WITH_TOOL, {
      test_cat: ['test_cat'],
      unknown_cat: [],
    })
    expect(result[0].perStack['java'].kind).toBe('tool')
    expect(result[1].perStack['java'].kind).toBe('gap')
  })

  it('gap overlay without informative field fails Zod validation', () => {
    expect(() =>
      KitOverlayCellSchema.parse({
        kind: 'gap',
        reason: 'This reason is exactly forty chars minimum to pass basic len check.',
      }),
    ).toThrow()
  })

  it('gap overlay with followupIssue passes Zod validation', () => {
    expect(() =>
      KitOverlayCellSchema.parse({
        kind: 'gap',
        followupIssue: 862,
        reason: 'This reason is exactly forty chars minimum to pass basic len check.',
      }),
    ).not.toThrow()
  })

  it('overlay na-by-paradigm overrides', () => {
    const overlay: KitOverlay = {
      N01: {
        rust: {
          kind: 'na-by-paradigm',
          reason:
            'Rust ownership model makes this pattern unnecessary; compiler enforces correctness statically',
        },
      },
    }
    const result = deriveKit([minDim()], overlay, MATRIX_WITH_TOOL, CATEGORY_MAP)
    expect(result[0].perStack['rust'].kind).toBe('na-by-paradigm')
  })
})
