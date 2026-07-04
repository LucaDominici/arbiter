// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderOssfScorecard(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/17-ossf-scorecard.yml.ejs',
    makeConfig('/tmp/test', {
      collaborationMode: 'gated-review',
      governanceLevel: 'L3',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('17-ossf-scorecard.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L3', 'L4'] as const

  it.each(STACKS)('$language: workflow name contains "Scorecard"', ({ language, buildTool }) => {
    const rendered = renderOssfScorecard({ language, buildTool })
    expect(rendered).toContain('Scorecard')
  })

  it.each(STACKS)('$language: has on: section', ({ language, buildTool }) => {
    const rendered = renderOssfScorecard({ language, buildTool })
    expect(rendered).toMatch(/^on:/m)
  })

  it.each(STACKS)('$language: has jobs: section', ({ language, buildTool }) => {
    const rendered = renderOssfScorecard({ language, buildTool })
    expect(rendered).toMatch(/^jobs:/m)
  })

  it.each(STACKS)('$language: security-events: write permission', ({ language, buildTool }) => {
    const rendered = renderOssfScorecard({ language, buildTool })
    expect(rendered).toContain('security-events: write')
  })

  it.each(STACKS)('$language: uses scorecard-action', ({ language, buildTool }) => {
    const rendered = renderOssfScorecard({ language, buildTool })
    expect(rendered).toContain('scorecard-action')
  })

  it.each(STACKS)(
    '$language: publish_results: false (privacy default)',
    ({ language, buildTool }) => {
      const rendered = renderOssfScorecard({ language, buildTool })
      expect(rendered).toContain('publish_results: false')
    },
  )

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderOssfScorecard({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Runner fallback (#1770, #1756) ──────────────────────────────────────────
// gated-review + L3Plus must NEVER render a bare self-hosted default: an outsider
// repo without CI_BUILD_RUNNER_LABEL set would queue forever on docker-ci-build.

describe('17-ossf-scorecard.yml.ejs — runner fallback (#1770, #1756)', () => {
  it('gated-review + L3 falls back to ubuntu-latest, not docker-ci-build', () => {
    const rendered = renderOssfScorecard({
      collaborationMode: 'gated-review',
      governanceLevel: 'L3',
    })
    expect(rendered).not.toContain("'docker-ci-build'")
    expect(rendered).toContain("vars.CI_BUILD_RUNNER_LABEL || 'ubuntu-latest'")
  })
})

// ─── Trigger ─────────────────────────────────────────────────────────────────

describe('17-ossf-scorecard.yml.ejs — triggers', () => {
  it('schedule trigger present (weekly)', () => {
    const rendered = renderOssfScorecard({})
    expect(rendered).toContain('schedule:')
    expect(rendered).toContain('cron:')
  })

  it('push trigger on main branch', () => {
    const rendered = renderOssfScorecard({})
    expect(rendered).toContain('push:')
  })
})
