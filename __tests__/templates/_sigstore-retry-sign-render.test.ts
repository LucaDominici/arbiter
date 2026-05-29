import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('_sigstore-retry-sign.yml.ejs rendering (CANON-04, INV-76, #1076)', () => {
  const data = makeConfig('/tmp/test', {
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('renders cosign retry wrapper', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toContain('cosign sign-blob')
    expect(rendered).toContain('max-attempts')
  })

  it('has top-level permissions block', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('all action refs are SHA-pinned', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })

  it('implements exponential back-off retry', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toContain('delay=$((delay * 2))')
  })
})
