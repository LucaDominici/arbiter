// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for the ISO 9001 quality-process overlay EJS templates (#1253).

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(template: string) {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    industryOverlay: 'iso9001',
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate(template, data)
}

const DOC_TEMPLATES = [
  'quality/iso9001/REQUIREMENTS_TRACEABILITY.md.ejs',
  'quality/iso9001/DOCUMENT_CONTROL.md.ejs',
  'quality/iso9001/CAPA_LOG.md.ejs',
] as const

describe('ISO 9001 overlay templates (CANON-04, #1253)', () => {
  for (const t of [...DOC_TEMPLATES, 'scripts/check-iso9001.mjs.ejs']) {
    it(`${t} renders without EJS syntax errors`, () => {
      expect(() => render(t)).not.toThrow()
    })

    it(`${t} leaves no unrendered EJS markers`, () => {
      const out = render(t)
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })
  }

  for (const t of DOC_TEMPLATES) {
    it(`${t} is language-neutral (no Java/JPA/pharma leakage)`, () => {
      const out = render(t)
      expect(out).not.toContain('@Entity')
      expect(out).not.toContain('.java')
      expect(out).not.toContain('21 CFR')
    })
  }

  it('RTM template carries the reused FEATURE_MATRIX-style sentinel + status ladder', () => {
    const out = render('quality/iso9001/REQUIREMENTS_TRACEABILITY.md.ejs')
    expect(out).toContain('<!-- ISO9001_RTM_START -->')
    expect(out).toContain('requirement_id')
    expect(out).toContain('test_ref')
  })

  it('document-control template carries doc_version semantics', () => {
    const out = render('quality/iso9001/DOCUMENT_CONTROL.md.ejs')
    expect(out).toContain('doc_version')
    expect(out).toContain('<!-- DOC_CONTROL_START -->')
  })

  it('gate script template emits an executable node shebang + fail-closed exits', () => {
    const out = render('scripts/check-iso9001.mjs.ejs')
    expect(out.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(out).toContain('process.exit(1)')
    expect(out).toContain('process.exit(2)')
  })
})
