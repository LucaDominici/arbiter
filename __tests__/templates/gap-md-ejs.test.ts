// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// CANON-04 — every .ejs template has a render test.

const TEMPLATE = 'docs/GAP.md.ejs'

function render(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    TEMPLATE,
    makeConfig('/tmp/test-gap', {
      governanceLevel: 'L2',
      ...overrides,
    }) as unknown as Record<string, unknown>,
  )
}

const LEVELS = ['L2', 'L3', 'L4'] as const

describe('docs/GAP.md.ejs render parity', () => {
  it.each(LEVELS)('renders without error at %s', (governanceLevel) => {
    expect(() => render({ governanceLevel })).not.toThrow()
  })

  it.each(LEVELS)('%s: no unrendered EJS markers', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it.each(LEVELS)('%s: contains GAP_START sentinel', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).toContain('<!-- GAP_START -->')
  })

  it.each(LEVELS)('%s: contains GAP_END sentinel', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).toContain('<!-- GAP_END -->')
  })

  it.each(LEVELS)('%s: contains GAP title', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).toMatch(/GAP/i)
  })

  it.each(LEVELS)('%s: contains governance level in rendered output', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).toContain(governanceLevel)
  })
})
