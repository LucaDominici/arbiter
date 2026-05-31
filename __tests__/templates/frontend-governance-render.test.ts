// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderConstitution(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'frontend/FRONTEND_CONSTITUTION.md.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

function renderPrinciples(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'frontend/FE_DESIGN_PRINCIPLES.md.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

describe('FRONTEND_CONSTITUTION.md.ejs — structural invariants (CANON-04)', () => {
  const FRAMEWORKS = [
    { framework: 'vue', stateManager: 'pinia' },
    { framework: 'react', stateManager: 'zustand' },
    { framework: 'svelte', stateManager: 'svelte-store' },
  ] as const

  it.each(FRAMEWORKS)('$framework: no EJS tag leaks', ({ framework, stateManager }) => {
    const rendered = renderConstitution({ frontend: { framework, stateManager } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('renders FE001 rule', () => {
    const rendered = renderConstitution()
    expect(rendered).toContain('FE001')
  })

  it('renders FE002 rule', () => {
    const rendered = renderConstitution()
    expect(rendered).toContain('FE002')
  })

  it('renders FE003 rule', () => {
    const rendered = renderConstitution()
    expect(rendered).toContain('FE003')
  })

  it('renders FE004 rule', () => {
    const rendered = renderConstitution()
    expect(rendered).toContain('FE004')
  })

  it('renders FE005 rule', () => {
    const rendered = renderConstitution()
    expect(rendered).toContain('FE005')
  })

  it('renders FE006 rule', () => {
    const rendered = renderConstitution()
    expect(rendered).toContain('FE006')
  })

  it('renders safely with frontend: undefined (no crash, safe-default)', () => {
    expect(() => renderConstitution({ frontend: undefined })).not.toThrow()
    const rendered = renderConstitution({ frontend: undefined })
    expect(rendered).not.toContain('<%')
  })

  it('vue framework: constitution mentions Pinia as state manager', () => {
    const rendered = renderConstitution({ frontend: { framework: 'vue' } })
    expect(rendered).toMatch(/pinia/i)
  })

  it('react framework: constitution mentions Zustand as state manager', () => {
    const rendered = renderConstitution({ frontend: { framework: 'react' } })
    expect(rendered).toMatch(/zustand/i)
  })

  it('custom stateManager: used verbatim in output', () => {
    const rendered = renderConstitution({ frontend: { framework: 'vue', stateManager: 'mobx' } })
    expect(rendered).toContain('mobx')
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderConstitution({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

describe('FE_DESIGN_PRINCIPLES.md.ejs — structural invariants (CANON-04)', () => {
  // template is governance-level-agnostic (no level-conditional blocks)
  it('no EJS tag leaks', () => {
    const rendered = renderPrinciples()
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('renders semantic tokens principle', () => {
    const rendered = renderPrinciples()
    expect(rendered).toMatch(/semantic.token/i)
  })

  it('renders dark mode principle', () => {
    const rendered = renderPrinciples()
    expect(rendered).toMatch(/dark.mode/i)
  })

  it('renders accessibility principle', () => {
    const rendered = renderPrinciples()
    expect(rendered).toMatch(/accessib/i)
  })

  it('renders safely with frontend: undefined (no crash)', () => {
    expect(() => renderPrinciples({ frontend: undefined })).not.toThrow()
    const rendered = renderPrinciples({ frontend: undefined })
    expect(rendered).not.toContain('<%')
  })
})
