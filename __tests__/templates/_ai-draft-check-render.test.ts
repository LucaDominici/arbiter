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
    // #2552: the exemption moved from the job-level `if:` (`user.login !=
    // 'dependabot[bot]'`) into the script body as an early return, because
    // classifying AI-authorship now needs an API call the `if:` can't make.
    expect(rendered).toContain("pr.user.login === 'dependabot[bot]'")
    expect(rendered).toContain('is exempt from the AI-PR gate')
  })

  it('trunk-solo keeps the required check green through standing owner approval', () => {
    const rendered = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', {
      ...data,
      collaborationMode: 'trunk-solo',
    })
    expect(rendered).toContain('name: AI-PR human-approval check (INV-91)')
    expect(rendered).toContain(
      'INV-91 amended: trunk-solo — standing owner approval (sole developer)',
    )
    expect(rendered).not.toContain('Assert approved-by-human label on AI-authored PR')
    expect(rendered).not.toContain('actions/github-script@')
  })

  it.each(['peer-review', 'gated-review'] as const)(
    '%s retains the pre-amendment fail-closed workflow byte-for-byte',
    (collaborationMode) => {
      const baseline = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', data)
      const rendered = renderTemplate('github/workflows/_ai-draft-check.yml.ejs', {
        ...data,
        collaborationMode,
      })
      expect(rendered).toBe(baseline)
      expect(rendered).toContain('Assert approved-by-human label on AI-authored PR')
      expect(rendered).toContain('core.setFailed')
    },
  )
})
