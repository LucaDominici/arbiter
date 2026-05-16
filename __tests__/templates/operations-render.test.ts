import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// ─── operations/handbook.md.ejs (#717) ───────────────────────────────────────

describe('operations/handbook.md.ejs — operations handbook (#717)', () => {
  function render(overrides: Parameters<typeof makeConfig>[1] = {}): string {
    const config = makeConfig('/tmp/test', overrides)
    return renderTemplate(
      'operations/handbook.md.ejs',
      config as unknown as Record<string, unknown>,
    )
  }

  it('renders without EJS leaks for backend-web-db', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('all archetypes render without error', () => {
    for (const archetype of [
      'backend-web-db',
      'cli',
      'library',
      'data-pipeline',
      'frontend-spa',
      'embedded',
    ] as const) {
      expect(() => render({ archetype })).not.toThrow()
    }
  })

  it('contains project name', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content).toContain('test-project')
  })

  it('contains 4-signal observability section', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toContain('latency')
    expect(content.toLowerCase()).toContain('traffic')
    expect(content.toLowerCase()).toContain('error')
    expect(content.toLowerCase()).toContain('saturation')
  })

  it('contains release candidate checklist', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toMatch(/release.*checklist|checklist.*release|rc checklist/i)
  })

  it('contains runbook section', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toContain('runbook')
  })

  it('contains on-call / incident response section', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toMatch(/on.call|incident|alert/)
  })
})
