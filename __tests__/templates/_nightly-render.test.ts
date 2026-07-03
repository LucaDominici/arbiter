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

  it('has explicit reusable workflow display name', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toMatch(/^name: Nightly jobs \(reusable\)$/m)
  })

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

  it('nightly does not define a mutation-deep job (#1692)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('mutation-deep')
  })

  it('nightly delegates to shared-security partial (#1694)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('shared-security:')
    expect(rendered).toContain('nvd-cache-namespace: nightly')
  })

  it('nightly does NOT define inline dep-cve-refresh job (#1694)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('dep-cve-refresh:')
  })

  it('nightly does NOT define inline dast-full job (#1694)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('dast-full:')
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

// #1693 (ADR-101): runnerProfile axis. 'fleet' (default) keeps fuzz+soak-e2e at
// nightly cadence (byte-behavior-identical to pre-#1693). 'solo' moves them to
// the weekly partial (see _weekly-render.test.ts) — nightly must drop both the
// job definitions AND every dangling needs:/RESULTS reference to them.
describe('_nightly.yml.ejs — runnerProfile axis (#1693, ADR-101)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  it.each(STACKS)(
    '$language: fleet (default) keeps fuzz + soak-e2e nightly',
    ({ language, buildTool }) => {
      const rendered = renderNightlyPartial({ language, buildTool })
      expect(rendered).toContain('fuzz:')
      expect(rendered).toContain('soak-e2e:')
      expect(rendered).toContain('- fuzz')
      expect(rendered).toContain('- soak-e2e')
      expect(rendered).toContain('needs.fuzz.result')
      expect(rendered).toContain('needs.soak-e2e.result')
    },
  )

  it.each(STACKS)(
    '$language: runnerProfile=solo removes fuzz + soak-e2e from nightly entirely',
    ({ language, buildTool }) => {
      const rendered = renderNightlyPartial({ language, buildTool, runnerProfile: 'solo' })
      expect(rendered).not.toContain('fuzz:')
      expect(rendered).not.toContain('soak-e2e:')
      expect(rendered).not.toContain('- fuzz')
      expect(rendered).not.toContain('- soak-e2e')
      expect(rendered).not.toContain('needs.fuzz.result')
      expect(rendered).not.toContain('needs.soak-e2e.result')
    },
  )

  it('runnerProfile=solo leaves no EJS tag leaks', () => {
    const rendered = renderNightlyPartial({ runnerProfile: 'solo' })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  // #1693 INV-48: direct path-string render of the extracted partial (not merely
  // transitive coverage via the parent) — satisfies check-template-tests.mjs's
  // literal relPath/stem match without bumping the baseline.
  it('scheduled-heavy-jobs.ejs partial renders fuzz + soak-e2e directly', () => {
    const rendered = renderTemplate(
      'github/workflows/_partials/scheduled-heavy-jobs.ejs',
      makeConfig('/tmp/test', { language: 'typescript', buildTool: 'npm' }),
    )
    expect(rendered).toContain('fuzz:')
    expect(rendered).toContain('soak-e2e:')
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})
