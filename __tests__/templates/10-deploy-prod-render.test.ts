// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderDeployProd(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/10-deploy-prod.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants (5 stacks × 3 governance levels) ────────

describe('10-deploy-prod.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "Deploy Prod"', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('name: Deploy Prod')
  })

  it.each(STACKS)(
    '$language: triggers on release published',
    ({ language, buildTool }) => {
      const rendered = renderDeployProd({ language, buildTool })
      expect(rendered).toContain('release:')
      expect(rendered).toContain('published')
    },
  )

  it.each(STACKS)('$language: id-token: write permission present', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('id-token: write')
  })

  it.each(STACKS)(
    '$language: concurrency cancel-in-progress false',
    ({ language, buildTool }) => {
      const rendered = renderDeployProd({ language, buildTool })
      expect(rendered).toContain('cancel-in-progress: false')
    },
  )

  it.each(STACKS)(
    '$language: deploy-prod job with environment gate',
    ({ language, buildTool }) => {
      const rendered = renderDeployProd({ language, buildTool })
      expect(rendered).toContain('deploy-prod:')
      expect(rendered).toContain('environment:')
      expect(rendered).toContain('production')
    },
  )

  it.each(STACKS)('$language: 30-day timeout (43200 minutes)', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('43200')
  })

  it.each(STACKS)('$language: notify-failure job present', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('notify-failure:')
    expect(rendered).toContain('if: failure()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderDeployProd({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it.each(LEVELS)('governance %s: workflow name present', (level) => {
    const rendered = renderDeployProd({ governanceLevel: level })
    expect(rendered).toContain('name: Deploy Prod')
  })
})

// ─── Security invariants ──────────────────────────────────────────────────────

describe('10-deploy-prod.yml.ejs — security invariants', () => {
  it('GitHub Environment "production" gate (required-reviewer)', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('name: production')
  })

  it('SCAFFOLD activation guard step present', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('SCAFFOLD')
  })

  it('SCAFFOLD_DRY_RUN guard present (bypass for tests)', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('SCAFFOLD_DRY_RUN')
  })

  it('PROD smoke skips gracefully when PROD_BASE_URL not set', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('PROD_BASE_URL')
    expect(rendered).toContain('skip')
  })
})

// ─── P0 notify ───────────────────────────────────────────────────────────────

describe('10-deploy-prod.yml.ejs — P0 failure notification', () => {
  it('notify-failure uses P0 severity', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('P0')
  })

  it('notify-failure references _notify.yml reusable workflow', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('_notify.yml')
  })
})
