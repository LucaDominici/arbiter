import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('suppressions template rendering (#166)', () => {
  describe('gitleaksignore.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/gitleaksignore.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName', () => {
      const out = renderTemplate('suppressions/gitleaksignore.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains suppression format instructions', () => {
      const out = renderTemplate('suppressions/gitleaksignore.ejs', cfg())
      expect(out).toContain('expiresAt')
    })
  })

  describe('pii-allowlist.json.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/pii-allowlist.json.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('renders valid JSON array', () => {
      const out = renderTemplate('suppressions/pii-allowlist.json.ejs', cfg())
      expect(() => JSON.parse(out)).not.toThrow()
    })
  })

  describe('suppressions-schema.json.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains $schema field', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      expect(out).toContain('"$schema"')
    })
  })

  describe('archunit-baseline.json.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/archunit-baseline.json.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('renders valid JSON array', () => {
      const out = renderTemplate('suppressions/archunit-baseline.json.ejs', cfg())
      expect(() => JSON.parse(out)).not.toThrow()
    })
  })

  describe('dependency-check-suppressions.xml.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/dependency-check-suppressions.xml.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName', () => {
      const out = renderTemplate('suppressions/dependency-check-suppressions.xml.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains suppressions XML root element', () => {
      const out = renderTemplate('suppressions/dependency-check-suppressions.xml.ejs', cfg())
      expect(out).toContain('<suppressions')
    })
  })
})
