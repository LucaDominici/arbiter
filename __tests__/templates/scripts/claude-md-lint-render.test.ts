import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'scripts/check-claude-md-lint.mjs.ejs'

describe('check-claude-md-lint template (#1266)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('starts with a Node shebang', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out.trimStart()).toMatch(/^#!\/usr\/bin\/env node/)
  })

  it('contains project name in header comment', () => {
    const out = renderTemplate(TEMPLATE, cfg({ projectName: 'my-project' }))
    expect(out).toContain('my-project')
  })

  it('supports --help and cites INV-89', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).toContain('--help')
    expect(out).toContain('INV-89')
  })

  it('renders identically at L1, L2, and L3', () => {
    const l1 = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L1' }))
    const l2 = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    const l3 = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L3' }))
    const normalize = (s: string) => s.replace(/my-project|test-project/g, 'PROJECT')
    expect(normalize(l1)).toBe(normalize(l2))
    expect(normalize(l2)).toBe(normalize(l3))
  })

  it('is wired into the target check-all template', () => {
    // #2041: check-all.mjs.ejs is registry-driven — render through the shared helper.
    const out = renderCheckAll(
      cfg({
        language: 'typescript',
        coverageEnabled: false,
        enableDebtGates: false,
        enableSecurityScanning: false,
      }),
    )
    expect(out).toContain('scripts/check-claude-md-lint.mjs')
  })
})
