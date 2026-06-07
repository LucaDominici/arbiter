// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for the GDPR controls→gates EJS templates (#1251).
// Disjoint from audit-generic-render.test.ts — covers the gdpr-specific overlay
// (enforceable controls gate script + DPIA + data-flow map + traceability doc).

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(template: string) {
  const data = makeConfig('/tmp/test-gdpr', {
    language: 'typescript',
    projectName: 'gdpr-render-app',
    industryOverlay: 'gdpr',
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate(template, data)
}

const TEMPLATES = [
  'audit/gdpr/check-gdpr-controls.mjs.ejs',
  'audit/gdpr/dpia.md.ejs',
  'audit/gdpr/data-flow-map.md.ejs',
  'audit/gdpr/controls-to-gates.md.ejs',
] as const

describe('gdpr controls→gates templates (CANON-04, #1251)', () => {
  for (const t of TEMPLATES) {
    it(`${t} renders without EJS syntax errors`, () => {
      expect(() => render(t)).not.toThrow()
    })

    it(`${t} leaves no unrendered EJS markers`, () => {
      const out = render(t)
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it(`${t} interpolates projectName`, () => {
      expect(render(t)).toContain('gdpr-render-app')
    })
  }

  it('the controls→gate doc maps each control to the enforcing gate', () => {
    const out = render('audit/gdpr/controls-to-gates.md.ejs')
    for (const id of ['GDPR-01', 'GDPR-02', 'GDPR-03', 'GDPR-04', 'GDPR-05']) {
      expect(out).toContain(id)
    }
    expect(out).toContain('check-gdpr-controls.mjs')
    expect(out).toContain('erasure')
    expect(out).toContain('consent')
  })

  it('the gate script enforces the GDPR controls (exits 1 with a FAIL banner)', () => {
    const out = render('audit/gdpr/check-gdpr-controls.mjs.ejs')
    expect(out).toContain('process.exit(1)')
    expect(out).toContain('check-gdpr-controls: FAIL')
    expect(out).toContain('GDPR-01')
  })

  it('the data-flow map documents retention windows', () => {
    expect(render('audit/gdpr/data-flow-map.md.ejs').toLowerCase()).toContain('retention')
  })
})
