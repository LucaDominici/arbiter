import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderMonthly(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/08-monthly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants — caller file ────────────────────────────
// Job definitions live in _monthly.yml.ejs (tested in _monthly-render.test.ts).
// This file tests only the thin caller: triggers, concurrency, and the uses: ref.

describe('08-monthly.yml.ejs — caller structural invariants (CANON-18)', () => {
  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('workflow name is "Monthly (T5b)"', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('name: Monthly (T5b)')
  })

  it('top-level permissions include contents: read and issues: write', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('contents: read')
    expect(rendered).toContain('issues: write')
  })

  it('dispatches to _monthly.yml reusable workflow', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('uses: ./.github/workflows/_monthly.yml')
  })

  it('passes secrets: inherit to the reusable workflow', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('secrets: inherit')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderMonthly({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Trigger and schedule ─────────────────────────────────────────────────────

describe('08-monthly.yml.ejs — trigger and schedule', () => {
  it('cron schedule is 04:00 UTC on day 1 of each month', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain("cron: '0 4 1 * *'")
  })

  it('workflow_dispatch trigger present', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('workflow_dispatch:')
  })

  it('concurrency group is monthly with cancel-in-progress: false', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('group: monthly')
    expect(rendered).toContain('cancel-in-progress: false')
  })
})
