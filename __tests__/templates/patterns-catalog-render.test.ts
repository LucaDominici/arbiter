import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'root/docs/METHOD/PATTERNS_CATALOG.md.ejs'

const FIELD_LABELS = [
  '**Use when:**',
  '**Avoid when:**',
  '**Registry path:**',
  '**Variation axis:**',
  '**Test approach:**',
  '**Rejected alternatives:**',
]

describe('PATTERNS_CATALOG.md.ejs render (#2079)', () => {
  it('renders without EJS leaks at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains project name when rendered at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2', projectName: 'acme-app' }))
    expect(out).toContain('acme-app')
  })

  it('carries the PATTERNS_CATALOG canonical_id in frontmatter at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toMatch(/canonical_id:\s*'PATTERNS_CATALOG'/)
  })

  it('documents the six-field entry schema at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toMatch(/##\s+Purpose/)
    expect(out).toMatch(/##\s+Entry schema/)
    for (const label of FIELD_LABELS) {
      expect(out).toContain(label)
    }
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
