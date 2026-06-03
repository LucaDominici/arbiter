// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for the generic audit-trail EJS templates (#1156).

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(template: string, overlay: 'generic' | 'sox' | 'gdpr') {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    industryOverlay: overlay,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate(template, data)
}

const TEMPLATES = [
  'audit/generic/audit-trail-policy.md.ejs',
  'audit/generic/audit-gate-rules.md.ejs',
] as const

describe('generic audit-trail templates (CANON-04, #1156)', () => {
  for (const t of TEMPLATES) {
    it(`${t} renders without EJS syntax errors for each overlay`, () => {
      for (const overlay of ['generic', 'sox', 'gdpr'] as const) {
        expect(() => render(t, overlay)).not.toThrow()
      }
    })

    it(`${t} leaves no unrendered EJS markers`, () => {
      const out = render(t, 'generic')
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it(`${t} is language-neutral (no Java/JPA/pharma leakage)`, () => {
      const out = render(t, 'generic')
      expect(out).not.toContain('@Entity')
      expect(out).not.toContain('21 CFR')
      expect(out).not.toContain('.java')
    })

    it(`${t} interpolates the overlay name`, () => {
      expect(render(t, 'sox')).toContain('SOX')
      expect(render(t, 'gdpr')).toContain('GDPR')
    })
  }
})
