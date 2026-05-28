import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('semantic-review.yml.ejs rendering (CANON-04, INV-77, #1076)', () => {
  it('renders for L2 and above', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/semantic-review.yml.ejs', data)
    expect(rendered).toContain('Semantic')
    expect(rendered).toContain('graph build')
  })

  it('omitted at L1 (CANON-13 guard)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/semantic-review.yml.ejs', data)
    expect(rendered.trim()).toBe('')
  })

  it('has top-level permissions block at L2', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/semantic-review.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('all action refs are SHA-pinned at L2', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/semantic-review.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })
})
