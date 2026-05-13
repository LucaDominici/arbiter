import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('POST_MERGE_REVIEW_TEMPLATE.md.ejs (#218)', () => {
  it('renders without EJS leaks for L2', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/POST_MERGE_REVIEW_TEMPLATE.md.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('contains summary table with verdict thresholds', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/POST_MERGE_REVIEW_TEMPLATE.md.ejs', data)
    expect(rendered).toContain('PASS')
    expect(rendered).toContain('CONCERNS')
    expect(rendered).toContain('FAIL')
  })

  it('contains finding classification table (P1-P5)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/POST_MERGE_REVIEW_TEMPLATE.md.ejs', data)
    expect(rendered).toMatch(/P1/)
    expect(rendered).toMatch(/P2/)
    expect(rendered).toMatch(/P5/)
  })

  it('notes security findings weighted 2x', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/POST_MERGE_REVIEW_TEMPLATE.md.ejs', data)
    expect(rendered).toMatch(/2[×x]/i)
    expect(rendered).toMatch(/security/i)
  })

  it('contains Bundle Details section', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/POST_MERGE_REVIEW_TEMPLATE.md.ejs', data)
    expect(rendered).toMatch(/[Bb]undle/)
  })
})
