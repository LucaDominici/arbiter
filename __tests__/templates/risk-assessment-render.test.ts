import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('RISK_ASSESSMENT.md.ejs template rendering (#207)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('security/RISK_ASSESSMENT.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains P×I matrix heading', () => {
    const out = renderTemplate('security/RISK_ASSESSMENT.md.ejs', cfg())
    expect(out).toContain('P×I')
  })

  it('contains ISO 27001:2022 §6.1.2 reference', () => {
    const out = renderTemplate('security/RISK_ASSESSMENT.md.ejs', cfg())
    expect(out).toContain('ISO 27001:2022 §6.1.2')
  })

  it('contains threshold tier ≤ 4 (Low)', () => {
    const out = renderTemplate('security/RISK_ASSESSMENT.md.ejs', cfg())
    expect(out).toContain('≤ 4')
  })

  it('contains threshold tier 5–8 (Medium)', () => {
    const out = renderTemplate('security/RISK_ASSESSMENT.md.ejs', cfg())
    expect(out).toContain('5–8')
  })

  it('contains threshold tier 9–12 (High)', () => {
    const out = renderTemplate('security/RISK_ASSESSMENT.md.ejs', cfg())
    expect(out).toContain('9–12')
  })

  it('contains threshold tier > 12 (Critical)', () => {
    const out = renderTemplate('security/RISK_ASSESSMENT.md.ejs', cfg())
    expect(out).toContain('> 12')
  })
})
