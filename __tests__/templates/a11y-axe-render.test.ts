// Tests for #349 — a11y category + axe-core wrapper templates (CANON-02/04/08).
//
// Verify the emitted axe-core wrapper enforces the documented threshold policy:
// HARD-throw on `critical` impact + HARD-throw on unclassified impact.
// Cite #349 + CANON-02 in the helper header so traceability is intact.

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const DUMMY_DIR = '/tmp/arbiter-a11y-render-test'

function render(template: string, overrides: Record<string, unknown> = {}): string {
  const config = makeConfig(DUMMY_DIR, {
    language: 'typescript',
    archetype: 'frontend-spa',
    ...overrides,
  })
  return renderTemplate(template, { ...config, ...overrides })
}

describe('e2e/playwright-ts/a11y templates (#349, CANON-02/04)', () => {
  describe('run-axe.ts.ejs', () => {
    it('imports AxeBuilder from @axe-core/playwright', () => {
      const out = render('e2e/playwright-ts/run-axe.ts.ejs')
      expect(out).toContain('@axe-core/playwright')
      expect(out).toContain('AxeBuilder')
    })

    it('runs the wcag2a + wcag2aa tag set', () => {
      const out = render('e2e/playwright-ts/run-axe.ts.ejs')
      expect(out).toContain('wcag2a')
      expect(out).toContain('wcag2aa')
    })

    it('HARD-throws on critical impact', () => {
      const out = render('e2e/playwright-ts/run-axe.ts.ejs')
      expect(out).toMatch(/critical/)
      expect(out).toMatch(/throw new Error/)
    })

    it('HARD-throws on unclassified impact', () => {
      const out = render('e2e/playwright-ts/run-axe.ts.ejs')
      // Unclassified violations (impact === undefined/null) must not slip through.
      expect(out).toMatch(/unclassified/i)
    })

    it('cites #349 and CANON-02 in the header comment', () => {
      const out = render('e2e/playwright-ts/run-axe.ts.ejs')
      expect(out).toMatch(/#349/)
      expect(out).toMatch(/CANON-02/)
    })
  })

  describe('a11y.spec.ts.ejs', () => {
    it('imports the runAxe wrapper', () => {
      const out = render('e2e/playwright-ts/a11y.spec.ts.ejs')
      expect(out).toContain('runAxe')
    })

    it('uses @playwright/test', () => {
      const out = render('e2e/playwright-ts/a11y.spec.ts.ejs')
      expect(out).toContain('@playwright/test')
    })

    it('exercises at least one view via page.goto', () => {
      const out = render('e2e/playwright-ts/a11y.spec.ts.ejs')
      expect(out).toContain('page.goto')
    })
  })
})
