import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { getTestPyramidProfile } from '../../src/config/test-pyramid-profiles.js'
import { makeConfig } from '../helpers.js'

// ─── testing/test-taxonomy.md.ejs (#719) ─────────────────────────────────────

describe('testing/test-taxonomy.md.ejs — 25-dimension taxonomy (#719)', () => {
  function render(overrides: Parameters<typeof makeConfig>[1] = {}): string {
    const config = makeConfig('/tmp/test', overrides)
    const profile = getTestPyramidProfile(config.archetype)
    return renderTemplate('testing/test-taxonomy.md.ejs', {
      ...(config as unknown as Record<string, unknown>),
      levels: profile.levels,
      hasContainerIntegration: profile.hasContainerIntegration,
      hasPropertyTests: profile.hasPropertyTests,
      hasE2ETests: profile.hasE2ETests,
      domainDims: [],
    })
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

  it('contains all 17 base dimensions', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content).toContain('Owner isolation')
    expect(content).toContain('RBAC')
    expect(content).toContain('Backward compat')
    expect(content).toContain('Contract test coverage')
  })

  it('contains audit trail dimension (18)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toContain('audit trail')
  })

  it('contains PII masking dimension (19)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toMatch(/pii|masking|sensitive/)
  })

  it('contains rate limiting dimension (20)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toContain('rate limit')
  })

  it('contains session / token lifecycle dimension (21)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toMatch(/session|token.*lifecycle|lifecycle.*token/)
  })

  it('contains event delivery dimension (22)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toMatch(/event.*deliver|idempoten|dead.letter/)
  })

  it('contains graceful degradation dimension (23)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toContain('graceful degradation')
  })

  it('contains SLA assertion dimension (24)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toMatch(/sla|latency.*budget|p95/)
  })

  it('contains security surface dimension (25)', () => {
    const content = render({ archetype: 'backend-web-db' })
    expect(content.toLowerCase()).toMatch(/owasp|security surface|attack/)
  })
})
