import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderWeeklyPartial(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_weekly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('_weekly.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('has workflow_call trigger', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toContain('workflow_call:')
  })

  it('does NOT have schedule trigger (that stays in caller)', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('schedule:')
  })

  it('does NOT have workflow_dispatch trigger (that stays in caller)', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('workflow_dispatch:')
  })

  it('does NOT have concurrency block (that stays in caller)', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('concurrency:')
  })

  it.each(STACKS)('$language: dep-freshness job present', ({ language, buildTool }) => {
    const rendered = renderWeeklyPartial({ language, buildTool })
    expect(rendered).toContain('dep-freshness:')
  })

  it.each(STACKS)('$language: perf-trend job present', ({ language, buildTool }) => {
    const rendered = renderWeeklyPartial({ language, buildTool })
    expect(rendered).toContain('perf-trend:')
    expect(rendered).toContain('k6')
  })

  it.each(STACKS)('$language: action-version-audit job present', ({ language, buildTool }) => {
    const rendered = renderWeeklyPartial({ language, buildTool })
    expect(rendered).toContain('action-version-audit:')
  })

  it.each(STACKS)('$language: weekly-required aggregator present', ({ language, buildTool }) => {
    const rendered = renderWeeklyPartial({ language, buildTool })
    expect(rendered).toContain('weekly-required:')
    expect(rendered).toContain('if: always()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderWeeklyPartial({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('service archetype: cross-db-matrix job present', () => {
    const rendered = renderWeeklyPartial({ archetype: 'backend-web-db' })
    expect(rendered).toContain('cross-db-matrix:')
  })

  it('cli archetype: cross-os-matrix job present', () => {
    const rendered = renderWeeklyPartial({ archetype: 'cli', language: 'go', buildTool: 'go' })
    expect(rendered).toContain('cross-os-matrix:')
  })

  it('library archetype: no cross-db-matrix or cross-os-matrix', () => {
    const rendered = renderWeeklyPartial({ archetype: 'library' })
    expect(rendered).not.toContain('cross-db-matrix:')
    expect(rendered).not.toContain('cross-os-matrix:')
  })
})
