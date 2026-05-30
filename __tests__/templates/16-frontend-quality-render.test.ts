// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderFrontendQuality(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/16-frontend-quality.yml.ejs',
    makeConfig('/tmp/test', {
      collaborationMode: 'peer-review',
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('16-frontend-quality.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)(
    '$language: workflow name contains "Frontend Quality"',
    ({ language, buildTool }) => {
      const rendered = renderFrontendQuality({ language, buildTool })
      expect(rendered).toContain('Frontend Quality')
    },
  )

  it.each(STACKS)('$language: has on: section', ({ language, buildTool }) => {
    const rendered = renderFrontendQuality({ language, buildTool })
    expect(rendered).toMatch(/^on:/m)
  })

  it.each(STACKS)('$language: has jobs: section', ({ language, buildTool }) => {
    const rendered = renderFrontendQuality({ language, buildTool })
    expect(rendered).toMatch(/^jobs:/m)
  })

  it.each(STACKS)('$language: lighthouse or axe present', ({ language, buildTool }) => {
    const rendered = renderFrontendQuality({ language, buildTool })
    expect(rendered.toLowerCase()).toMatch(/lighthouse|lhci|axe/)
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderFrontendQuality({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Trigger ─────────────────────────────────────────────────────────────────

describe('16-frontend-quality.yml.ejs — triggers', () => {
  it('pull_request trigger present', () => {
    const rendered = renderFrontendQuality({})
    expect(rendered).toContain('pull_request:')
  })
})
