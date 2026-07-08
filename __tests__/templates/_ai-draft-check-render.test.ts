import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('_ai-draft-check.yml.ejs rendering (CANON-04, INV-91, #1076)', () => {
  const data = makeConfig('/tmp/test', {
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('renders INV-91 AI-PR gate', () => {
    const rendered = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', data)
    expect(rendered).toContain('INV-91')
    expect(rendered).toContain('approved-by-human')
  })

  it('has top-level permissions block', () => {
    const rendered = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('all action refs are SHA-pinned', () => {
    const rendered = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })

  it('triggers on pull_request label events', () => {
    const rendered = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', data)
    expect(rendered).toContain('labeled')
    expect(rendered).toContain('unlabeled')
  })

  it('exempts dependabot[bot] from the gate (noise, not a security gap)', () => {
    const rendered = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', data)
    expect(rendered).toContain("user.login != 'dependabot[bot]'")
  })
})
