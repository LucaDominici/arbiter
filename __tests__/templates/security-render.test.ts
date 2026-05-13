import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('security template rendering (#166)', () => {
  describe('STRIDE.md.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName in heading', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains STRIDE heading', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('STRIDE')
    })

    it('contains threat category columns', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('Category')
      expect(out).toContain('Severity')
      expect(out).toContain('Mitigation')
    })

    it('contains threat register table', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('Threat Register')
    })
  })
})
