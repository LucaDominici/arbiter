// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { RecipeSchema } from '../../src/recipes/schema.js'

// ── G1a unit 1 (#1318.4): recipe schema parses the new fields ─────────────────
describe('RecipeSchema — new init-quality fields (#1318.4)', () => {
  it('parses databaseEngine: "none"', () => {
    const parsed = RecipeSchema.parse({ databaseEngine: 'none' })
    expect(parsed.databaseEngine).toBe('none')
  })

  it('parses databaseEngine: "postgresql" (canonical spelling, not "postgres")', () => {
    const parsed = RecipeSchema.parse({ databaseEngine: 'postgresql' })
    expect(parsed.databaseEngine).toBe('postgresql')
  })

  it('rejects the misspelling "postgres"', () => {
    expect(() => RecipeSchema.parse({ databaseEngine: 'postgres' })).toThrow()
  })

  it('parses evidenceHarness boolean', () => {
    expect(RecipeSchema.parse({ evidenceHarness: true }).evidenceHarness).toBe(true)
  })

  it('parses lanes array', () => {
    const parsed = RecipeSchema.parse({ lanes: ['backend', 'docs'] })
    expect(parsed.lanes).toEqual(['backend', 'docs'])
  })

  it('parses contractType', () => {
    expect(RecipeSchema.parse({ contractType: 'rest-public' }).contractType).toBe('rest-public')
  })

  it('parses decomposition.backend', () => {
    const parsed = RecipeSchema.parse({ decomposition: { backend: 'markdown' } })
    expect(parsed.decomposition?.backend).toBe('markdown')
  })

  it('accepts all new fields together', () => {
    const parsed = RecipeSchema.parse({
      language: 'go',
      databaseEngine: 'sqlite',
      evidenceHarness: false,
      lanes: ['backend'],
      contractType: 'none',
      decomposition: { backend: 'github' },
    })
    expect(parsed.databaseEngine).toBe('sqlite')
    expect(parsed.lanes).toEqual(['backend'])
    expect(parsed.decomposition?.backend).toBe('github')
  })
})

// #1835 (Task B, #1825): recipe activation path for the collapsed 5-lane CI doctrine.
describe('RecipeSchema — enableFiveLaneCi (#1835)', () => {
  it('parses enableFiveLaneCi boolean', () => {
    const parsed = RecipeSchema.parse({ enableFiveLaneCi: true })
    expect(parsed.enableFiveLaneCi).toBe(true)
  })

  it('rejects a non-boolean enableFiveLaneCi', () => {
    expect(() => RecipeSchema.parse({ enableFiveLaneCi: 'yes' })).toThrow()
  })
})
