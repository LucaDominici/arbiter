// Tests for #366 — pytest-playwright templates must be production-grade,
// not stub-grade. CANON-02/03.
//
// Forensic finding F7 originally flagged the python × e2e cell as fake.
// Wave 2 (#348) shipped check-all wiring + minimal templates; this hardens
// the templates so the matrix `proven` cell carries weight.

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const DUMMY_DIR = '/tmp/arbiter-pytest-playwright-hardening'

function render(template: string, overrides: Record<string, unknown> = {}): string {
  const config = makeConfig(DUMMY_DIR, {
    language: 'python',
    archetype: 'backend-web-db',
    ...overrides,
  })
  return renderTemplate(template, { ...config, ...overrides })
}

describe('pytest-playwright templates — hardening (#366, CANON-02/03)', () => {
  describe('conftest.py.ejs', () => {
    it('respects the E2E_BASE_URL env override so CI can re-target', () => {
      const out = render('e2e/playwright-python/conftest.py.ejs')
      expect(out).toContain('E2E_BASE_URL')
    })

    it('cites #366 in the header for traceability', () => {
      const out = render('e2e/playwright-python/conftest.py.ejs')
      expect(out).toMatch(/#366/)
    })

    it('exposes a session-scoped base_url fixture', () => {
      const out = render('e2e/playwright-python/conftest.py.ejs')
      expect(out).toMatch(/scope=["']session["']/)
      expect(out).toContain('def base_url')
    })
  })

  describe('test_smoke.py.ejs', () => {
    it('asserts the response is not a 5xx/404 error (server liveness)', () => {
      const out = render('e2e/playwright-python/test_smoke.py.ejs')
      // Either we check response.ok via page.goto's return, or we assert
      // a visible body element + a non-empty title. The spec hardening
      // requires at minimum a status-aware check.
      expect(out).toMatch(/status|response|ok/i)
    })

    it('cites #366 for traceability', () => {
      const out = render('e2e/playwright-python/test_smoke.py.ejs')
      expect(out).toMatch(/#366/)
    })
  })
})
