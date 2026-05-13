import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const SCRIPT_TEMPLATES = [
  'scripts/check-ssot-core.mjs.ejs',
  'scripts/check-doc-links.mjs.ejs',
  'scripts/check-knowledge-map.mjs.ejs',
  'scripts/check-canonical-paths.mjs.ejs',
  'scripts/knowledge-map-update.mjs.ejs',
  'scripts/harness.mjs.ejs',
] as const

describe('SSOT script templates (#255)', () => {
  for (const template of SCRIPT_TEMPLATES) {
    describe(template, () => {
      it('renders without EJS leaks', () => {
        const out = renderTemplate(template, cfg())
        expect(out).not.toContain('<%')
        expect(out).not.toContain('%>')
      })

      it('starts with a Node shebang', () => {
        const out = renderTemplate(template, cfg())
        expect(out.trimStart()).toMatch(/^#!\/usr\/bin\/env node/)
      })

      it('contains project name in comment', () => {
        const out = renderTemplate(template, cfg({ projectName: 'my-project' }))
        expect(out).toContain('my-project')
      })

      it('renders identically at L1, L2, and L3', () => {
        const l1 = renderTemplate(template, cfg({ governanceLevel: 'L1' }))
        const l2 = renderTemplate(template, cfg({ governanceLevel: 'L2' }))
        const l3 = renderTemplate(template, cfg({ governanceLevel: 'L3' }))
        const normalize = (s: string) => s.replace(/my-project|test-project/g, 'PROJECT')
        expect(normalize(l1)).toBe(normalize(l2))
        expect(normalize(l2)).toBe(normalize(l3))
      })
    })
  }

  it('harness.mjs.ejs references all 4 gate scripts', () => {
    const out = renderTemplate('scripts/harness.mjs.ejs', cfg())
    expect(out).toContain('check-ssot-core')
    expect(out).toContain('check-doc-links')
    expect(out).toContain('check-knowledge-map')
    expect(out).toContain('check-canonical-paths')
  })

  it('check-ssot-core.mjs.ejs references SSOT_CORE_SET.md', () => {
    const out = renderTemplate('scripts/check-ssot-core.mjs.ejs', cfg())
    expect(out).toContain('SSOT_CORE_SET.md')
  })

  it('check-doc-links.mjs.ejs references CANONICAL_PATHS', () => {
    const out = renderTemplate('scripts/check-doc-links.mjs.ejs', cfg())
    expect(out).toContain('CANONICAL_PATHS')
  })

  it('knowledge-map-update.mjs.ejs references KNOWLEDGE_MAP.md', () => {
    const out = renderTemplate('scripts/knowledge-map-update.mjs.ejs', cfg())
    expect(out).toContain('KNOWLEDGE_MAP.md')
  })

  it('check-all.mjs.ejs contains all 4 SSOT gate runCheck calls (CANON-01, INV-54–57)', () => {
    const out = renderTemplate(
      'scripts/check-all.mjs.ejs',
      cfg({
        language: 'typescript',
        coverageEnabled: false,
        enableDebtGates: false,
        enableSecurityScanning: false,
      }),
    )
    expect(out).toContain('check-ssot-core')
    expect(out).toContain('check-doc-links')
    expect(out).toContain('check-knowledge-map')
    expect(out).toContain('check-canonical-paths')
  })
})
