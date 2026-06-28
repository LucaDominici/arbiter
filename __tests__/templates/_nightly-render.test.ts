import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderNightlyPartial(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_nightly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('_nightly.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('has workflow_call trigger', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toContain('workflow_call:')
  })

  it('does NOT have schedule trigger (that stays in caller)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('schedule:')
  })

  it('does NOT have workflow_dispatch trigger (that stays in caller)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('workflow_dispatch:')
  })

  it('does NOT have concurrency block (that stays in caller)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('concurrency:')
  })

  it.each(STACKS)('$language: mutation-deep job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('mutation-deep:')
  })

  it.each(STACKS)('$language: dep-cve-refresh job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('dep-cve-refresh:')
  })

  it.each(STACKS)('$language: fuzz job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('fuzz:')
  })

  it.each(STACKS)('$language: soak-e2e job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('soak-e2e:')
  })

  it.each(STACKS)('$language: gitleaks-history job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('gitleaks-history:')
  })

  it.each(STACKS)('$language: evidence-collect job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('evidence-collect:')
    expect(rendered).toContain('retention-days: 90')
  })

  it.each(STACKS)('$language: nightly-required aggregator present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('nightly-required:')
    expect(rendered).toContain('if: always()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderNightlyPartial({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('service archetype: toxiproxy-resilience job present with pinned binary', () => {
    const rendered = renderNightlyPartial({ archetype: 'backend-web-db' })
    expect(rendered).toContain('toxiproxy-resilience:')
    expect(rendered).not.toContain('shopify/toxiproxy-github-action')
    expect(rendered).toContain('releases/download/v2.12.0/toxiproxy-server-linux-amd64')
  })
})

// ─── Per-language mutation tools ──────────────────────────────────────────────

describe('_nightly.yml.ejs — per-language mutation tools', () => {
  it('TypeScript: Stryker mutation', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('stryker run')
  })

  it('Java Gradle: PITest mutation', () => {
    const rendered = renderNightlyPartial({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('pitest')
  })

  it('Go: go-mutesting (informational)', () => {
    const rendered = renderNightlyPartial({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('go-mutesting')
  })

  it('Python: mutmut full run', () => {
    const rendered = renderNightlyPartial({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('mutmut run')
  })

  it('Rust: cargo-mutants full suite', () => {
    const rendered = renderNightlyPartial({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo mutants')
  })
})
