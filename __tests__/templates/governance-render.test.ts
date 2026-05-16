import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('governance template rendering (#166, #712)', () => {
  describe('risk-register.md.ejs (#712)', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('all archetypes render without error', () => {
      for (const archetype of [
        'backend-web-db',
        'cli',
        'library',
        'data-pipeline',
        'frontend-spa',
        'embedded',
      ] as const) {
        expect(() =>
          renderTemplate('governance/risk-register.md.ejs', cfg({ archetype })),
        ).not.toThrow()
      }
    })

    it('contains project name', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains P×I matrix', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/Probability.*Impact|P.*×.*I/i)
    })

    it('contains ISO 27001 reference', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/ISO 27001|§6\.1\.2/i)
    })

    it('contains risk classification tiers', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/Critical|High|Medium|Low/i)
    })

    it('contains at least one pre-populated risk entry', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/R-\d+/)
    })
  })

  describe('risk-assessment-template.md.ejs (#712)', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('contains probability and impact fields', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).toMatch(/Probability|probability/i)
      expect(out).toMatch(/Impact|impact/i)
    })

    it('contains score calculation guidance', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).toMatch(/Score|score|P.*×.*I/i)
    })

    it('contains mitigation section', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).toMatch(/Mitigation|mitigation/i)
    })
  })

  describe('RACI.md.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName in heading', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains RACI role columns', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).toContain('Accountable')
      expect(out).toContain('Responsible')
      expect(out).toContain('Consulted')
      expect(out).toContain('Informed')
    })

    it('contains responsibility matrix heading', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).toContain('Responsibility Matrix')
    })
  })
})
