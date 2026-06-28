import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const ROOT = new URL('../../', import.meta.url).pathname

function renderNightly(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/06-nightly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants — caller file ────────────────────────────
// Job definitions live in _nightly.yml.ejs (tested in _nightly-render.test.ts).
// This file tests only the thin caller: triggers, concurrency, and the uses: ref.

describe('06-nightly.yml.ejs — caller structural invariants (CANON-18)', () => {
  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('workflow name is "Nightly (T4)"', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('name: Nightly (T4)')
  })

  it('top-level permissions include contents: read and issues: write', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('contents: read')
    expect(rendered).toContain('issues: write')
  })

  it('dispatches to _nightly.yml reusable workflow', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('uses: ./.github/workflows/_nightly.yml')
  })

  it('passes secrets: inherit to the reusable workflow', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('secrets: inherit')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderNightly({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Schedule and triggers ────────────────────────────────────────────────────

describe('06-nightly.yml.ejs — schedule', () => {
  it('cron schedule is 02:00 UTC daily', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain("cron: '0 2 * * *'")
  })

  it('workflow_dispatch trigger present', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('workflow_dispatch:')
  })

  it('concurrency cancel-in-progress is false (no mid-run cancellation)', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('cancel-in-progress: false')
  })

  it('concurrency group is nightly', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('group: nightly')
  })
})

// ─── Committed file guard ─────────────────────────────────────────────────────

describe('06-nightly.yml — committed file', () => {
  it('committed 06-nightly.yml dispatches to _nightly.yml (uses: ref)', () => {
    const wfPath = join(ROOT, '.github', 'workflows', '06-nightly.yml')
    const content = readFileSync(wfPath, 'utf-8')
    expect(content).toContain('uses: ./.github/workflows/_nightly.yml')
  })

  it('committed 06-nightly.yml: no job definitions (thin caller)', () => {
    const wfPath = join(ROOT, '.github', 'workflows', '06-nightly.yml')
    const content = readFileSync(wfPath, 'utf-8')
    // The caller must not contain job-level steps — it only has the uses: ref job
    expect(content).not.toContain('mutation-deep:')
    expect(content).not.toContain('dep-cve-refresh:')
    expect(content).not.toContain('fuzz:')
  })
})
