// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'docs/FEATURE_MATRIX.md.ejs',
    makeConfig('/tmp/test-fm', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

const LEVELS = ['L2', 'L3', 'L4'] as const

describe('docs/FEATURE_MATRIX.md.ejs — structural invariants (CANON-23, INV-112)', () => {
  it.each(LEVELS)('renders without error at %s', (governanceLevel) => {
    expect(() => render({ governanceLevel })).not.toThrow()
  })

  it.each(LEVELS)('%s: contains sentinel markers', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).toContain('<!-- FEATURE_MATRIX_START -->')
    expect(out).toContain('<!-- FEATURE_MATRIX_END -->')
  })

  it.each(LEVELS)('%s: contains column header matching Track A schema', (governanceLevel) => {
    const out = render({ governanceLevel })
    for (const col of [
      'feature_id',
      'capability',
      'kit_dims',
      'level',
      'status',
      'code_ref',
      'test_ref',
      'doc_ref',
      'issue_ref',
      'note',
    ]) {
      expect(out, `Missing column "${col}" at ${governanceLevel}`).toContain(col)
    }
  })

  it.each(LEVELS)('%s: status vocabulary matches Track A', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).toContain('Missing')
    expect(out).toContain('Partial')
    expect(out).toContain('Done')
    expect(out).toContain('Verified')
  })

  it.each(LEVELS)('%s: contains governance level in rendered output', (governanceLevel) => {
    const out = render({ governanceLevel })
    expect(out).toContain(governanceLevel)
  })
})
