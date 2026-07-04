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

  const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const

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

// ─── Runner fallback (#1770, #1756) ──────────────────────────────────────────
// gated-review + L3Plus must NEVER render a bare self-hosted default: an outsider
// repo without CI_BUILD_RUNNER_LABEL set would queue forever on docker-ci-build.

describe('16-frontend-quality.yml.ejs — runner fallback (#1770, #1756)', () => {
  it('gated-review + L3 falls back to ubuntu-latest, not docker-ci-build', () => {
    const rendered = renderFrontendQuality({
      collaborationMode: 'gated-review',
      governanceLevel: 'L3',
    })
    expect(rendered).not.toContain("'docker-ci-build'")
    expect(rendered).toContain("vars.CI_BUILD_RUNNER_LABEL || 'ubuntu-latest'")
  })
})

// ─── Trigger ─────────────────────────────────────────────────────────────────

describe('16-frontend-quality.yml.ejs — triggers', () => {
  it('pull_request trigger present', () => {
    const rendered = renderFrontendQuality({})
    expect(rendered).toContain('pull_request:')
  })
})

// ─── a11y blocking gate (#1127 Slice 1) ──────────────────────────────────────
describe('16-frontend-quality.yml.ejs — a11y blocking gate (#1127)', () => {
  it('a11y step does NOT use || true (must be blocking, not soft-fail)', () => {
    const rendered = renderFrontendQuality({})
    // Must not suppress failures in the a11y step
    expect(rendered).not.toContain('|| true')
  })

  it('a11y step routes through playwright spec (uses npx playwright test)', () => {
    const rendered = renderFrontendQuality({})
    expect(rendered).toMatch(/playwright\s+test/)
  })

  it('a11y job does NOT directly call axe-core-npm/cli (old broken approach)', () => {
    const rendered = renderFrontendQuality({})
    // The old approach hit localhost:3000 with no server — must be replaced
    expect(rendered).not.toContain('axe-core-npm/cli')
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)(
    'governance %s: no || true in rendered output',
    (governanceLevel) => {
      const rendered = renderFrontendQuality({ governanceLevel })
      expect(rendered).not.toContain('|| true')
    },
  )
})
