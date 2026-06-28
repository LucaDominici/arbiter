import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderWeekly(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/07-weekly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants — caller file ────────────────────────────
// Job definitions live in _weekly.yml.ejs (tested in _weekly-render.test.ts).
// This file tests only the thin caller: triggers, concurrency, and the uses: ref.

describe('07-weekly.yml.ejs — caller structural invariants (CANON-18)', () => {
  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('workflow name is "Weekly (T5)"', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('name: Weekly (T5)')
  })

  it('top-level permissions include contents: read and issues: write', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('contents: read')
    expect(rendered).toContain('issues: write')
  })

  it('dispatches to _weekly.yml reusable workflow', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('uses: ./.github/workflows/_weekly.yml')
  })

  it('passes secrets: inherit to the reusable workflow', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('secrets: inherit')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderWeekly({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Schedule and triggers ────────────────────────────────────────────────────

describe('07-weekly.yml.ejs — schedule', () => {
  it('cron schedule is Sunday 04:00 UTC', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain("cron: '0 4 * * 0'")
  })

  it('workflow_dispatch trigger present', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('workflow_dispatch:')
  })

  it('concurrency cancel-in-progress is false', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('cancel-in-progress: false')
  })

  it('concurrency group is weekly', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('group: weekly')
  })
})
