import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderMonthlyPartial(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_monthly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('_monthly.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('has explicit reusable workflow display name', () => {
    const rendered = renderMonthlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toMatch(/^name: Monthly jobs \(reusable\)$/m)
  })

  it('has workflow_call trigger', () => {
    const rendered = renderMonthlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toContain('workflow_call:')
  })

  it('does NOT have schedule trigger (that stays in caller)', () => {
    const rendered = renderMonthlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('schedule:')
  })

  it('does NOT have workflow_dispatch trigger (that stays in caller)', () => {
    const rendered = renderMonthlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('workflow_dispatch:')
  })

  it('does NOT have concurrency block (that stays in caller)', () => {
    const rendered = renderMonthlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('concurrency:')
  })

  it.each(STACKS)('$language/$buildTool: dep-age-audit job present', ({ language, buildTool }) => {
    const rendered = renderMonthlyPartial({ language, buildTool })
    expect(rendered).toContain('dep-age-audit:')
  })

  it.each(STACKS)(
    '$language/$buildTool: license-full-audit job present',
    ({ language, buildTool }) => {
      const rendered = renderMonthlyPartial({ language, buildTool })
      expect(rendered).toContain('license-full-audit:')
    },
  )

  it.each(STACKS)(
    '$language/$buildTool: action-pins-stale-audit job present',
    ({ language, buildTool }) => {
      const rendered = renderMonthlyPartial({ language, buildTool })
      expect(rendered).toContain('action-pins-stale-audit:')
    },
  )

  it.each(STACKS)('$language/$buildTool: sbom-archive job present', ({ language, buildTool }) => {
    const rendered = renderMonthlyPartial({ language, buildTool })
    expect(rendered).toContain('sbom-archive:')
  })

  it.each(STACKS)(
    '$language/$buildTool: monthly-required gate job present',
    ({ language, buildTool }) => {
      const rendered = renderMonthlyPartial({ language, buildTool })
      expect(rendered).toContain('monthly-required:')
    },
  )

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderMonthlyPartial({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('artifacts have 365-day retention', () => {
    const rendered = renderMonthlyPartial({})
    expect(rendered).toContain('retention-days: 365')
  })

  it('action-pins-stale-audit has per-job permissions narrowing preserved', () => {
    const rendered = renderMonthlyPartial({})
    // The action-pins-stale-audit job has a per-job permissions: contents: read override
    const section = rendered.split('action-pins-stale-audit:')[1] ?? ''
    const untilNext = section.split('sbom-archive:')[0]
    expect(untilNext).toContain('permissions:')
    expect(untilNext).toContain('contents: read')
  })
})
