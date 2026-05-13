import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('ISO27001_ANNEX_A.md.ejs (#217)', () => {
  it('renders without EJS leaks for L3', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('contains A.5 Organizational Controls section', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('A.5')
    expect(rendered).toMatch(/[Oo]rganizational/)
  })

  it('contains A.8 Technological Controls section', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('A.8')
    expect(rendered).toMatch(/[Tt]echnological/)
  })

  it('pre-populates SECURE_CODING_CHECKLIST as covered (A.8.26)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('SECURE_CODING_CHECKLIST')
  })

  it('marks check-all gate as covered (A.8.25)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('check-all')
  })

  it('contains summary table with covered/gap counts', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toMatch(/[Cc]overed|✅/)
    expect(rendered).toMatch(/[Gg]ap|❌/)
  })
})
