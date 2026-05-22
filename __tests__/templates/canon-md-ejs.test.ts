import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// CANON-21 + INV-94 (#989) — scaffold template render coverage.
//
// Pattern mirrors __tests__/templates/context-pack-spec-render.test.ts.
// Whole-file EJS guard: emits ONLY at L2 and L3, empty body at L1.

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'root/docs/SYSTEM/CANON.md.ejs'

describe('CANON.md.ejs scaffold render (#989)', () => {
  it('emits empty body at L1 (L2+ guard)', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L1' }))
    expect(out.trim()).toBe('')
  })

  it('renders without EJS leak markers at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains the CANON-21 entry and its key wording at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toContain('CANON-21')
    expect(out).toMatch(/Aggregate, don't proliferate/i)
    expect(out).toMatch(/\/\/\s*CATALOG:/)
  })

  it('interpolates projectName into the title at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2', projectName: 'acme-app' }))
    expect(out).toContain('acme-app')
  })

  it('contains the full CANON-01 through CANON-21 catalog at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    for (let i = 1; i <= 21; i++) {
      const id = `CANON-${String(i).padStart(2, '0')}`
      expect(out).toContain(id)
    }
  })

  it('emits at L3 with the L3/L4 stricter enforcement notes', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L3' }))
    expect(out).toContain('CANON-21')
    // L3/L4 conditional content from CANON-16 and CANON-21 blocks
    expect(out).toMatch(/L3\/L4 note:/)
  })

  it('emits at L4 with the L3/L4 stricter enforcement notes', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L4' }))
    expect(out).toContain('CANON-21')
    expect(out).toMatch(/L3\/L4 note:/)
  })

  it('does NOT emit the L3/L4 notes at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toMatch(/L3\/L4 note:/)
  })

  it('renders the doc front-matter (title, status) at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toMatch(/^---/m)
    expect(out).toMatch(/title:\s*'.*CANON/)
    expect(out).toMatch(/status:\s*active/)
  })
})
