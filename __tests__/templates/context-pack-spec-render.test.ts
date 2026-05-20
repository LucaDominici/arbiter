import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'root/docs/METHOD/CONTEXT_PACK_SPEC.md.ejs'

describe('CONTEXT_PACK_SPEC.md.ejs render (#975)', () => {
  it('renders without EJS leaks at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains project name when rendered at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2', projectName: 'acme-app' }))
    expect(out).toContain('acme-app')
  })

  it('contains the authority chain anchors at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toContain('GLOBAL_INVARIANTS.md')
    expect(out).toContain('KNOWLEDGE_MAP.md')
    expect(out).toContain('CONTEXT_PACK_SPEC.md')
  })

  it('contains the schema section markers at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toMatch(/##\s+Header/)
    expect(out).toMatch(/##\s+Task Identity/)
    expect(out).toMatch(/##\s+INV Set/)
    expect(out).toMatch(/##\s+CANON Set/)
    expect(out).toMatch(/##\s+Excerpts/)
    expect(out).toMatch(/##\s+Footer/)
  })

  it('emits empty body at L1 (L2+ guard)', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L1' }))
    expect(out.trim()).toBe('')
  })

  it('renders identically at L2 and L3', () => {
    const l2 = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    const l3 = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L3' }))
    expect(l2).toBe(l3)
  })
})
