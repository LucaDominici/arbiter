// SPDX-License-Identifier: Apache-2.0
// #1254: render test for the (team × compliance) menu template. Ensures the menu
// renders both axes, the coherence table, and stays language-neutral across stacks.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const STACKS = ['typescript', 'java', 'go', 'python', 'rust'] as const

function renderMenu(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'compliance/compliance-menu.md.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('compliance-menu.md.ejs — structural invariants (#1254)', () => {
  it.each(STACKS)('%s: renders the title and arbiter-managed marker', (language) => {
    const out = renderMenu({ language })
    expect(out).toContain('Compliance & Collaboration Menu')
    expect(out).toContain('arbiter-managed: compliance-menu (#1254)')
  })

  it.each(STACKS)('%s: presents the team axis (all three modes)', (language) => {
    const out = renderMenu({ language })
    expect(out).toContain('trunk-solo')
    expect(out).toContain('peer-review')
    expect(out).toContain('gated-review')
  })

  it.each(STACKS)('%s: presents the compliance axis (all overlays)', (language) => {
    const out = renderMenu({ language })
    for (const overlay of ['generic', 'sox', 'gdpr', 'iso9001', 'iso27001', 'pharma']) {
      expect(out, `${language} missing ${overlay}`).toContain(overlay)
    }
  })

  it.each(STACKS)('%s: renders the (overlay × governanceLevel) coherence table', (language) => {
    const out = renderMenu({ language })
    expect(out).toMatch(/Coherence/i)
    expect(out).toContain('heavy')
    expect(out).toContain('WARN')
    expect(out).toContain('L3')
  })

  it.each(STACKS)('%s: is language-neutral (no Java/JPA leakage)', (language) => {
    const out = renderMenu({ language })
    expect(out).not.toContain('@Entity')
    expect(out).not.toContain('.java')
  })

  it('interpolates the project name', () => {
    const out = renderMenu({ language: 'typescript', projectName: 'acme-svc' })
    expect(out).toContain('acme-svc')
  })
})
