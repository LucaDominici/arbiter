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

  it('has explicit reusable workflow display name', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toMatch(/^name: Weekly jobs \(reusable\)$/m)
  })

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

  it('weekly delegates to shared-security partial (#1694)', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('shared-security:')
    expect(rendered).toContain('nvd-cache-namespace: weekly')
  })

  it('weekly-required needs list contains shared-security (#1694)', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', buildTool: 'npm' })
    // Find weekly-required section and check shared-security is in needs
    expect(rendered).toContain('- shared-security')
  })
})

// #1693 (ADR-101): runnerProfile axis. 'fleet' (default) never touches weekly
// (fuzz+soak-e2e stay nightly — see _nightly-render.test.ts). 'solo' moves the
// two heavy jobs here, and — CRITICAL (B1) — weekly-required must still hard-fail
// + file an issue when either fails, exactly like nightly-required does today.
describe('_weekly.yml.ejs — runnerProfile axis (#1693, ADR-101)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  it.each(STACKS)(
    '$language: fleet (default) has no fuzz/soak-e2e in weekly',
    ({ language, buildTool }) => {
      const rendered = renderWeeklyPartial({ language, buildTool })
      expect(rendered).not.toContain('fuzz:')
      expect(rendered).not.toContain('soak-e2e:')
      expect(rendered).not.toContain('needs.fuzz.result')
      expect(rendered).not.toContain('needs.soak-e2e.result')
    },
  )

  it.each(STACKS)(
    '$language: runnerProfile=solo adds fuzz + soak-e2e to weekly',
    ({ language, buildTool }) => {
      const rendered = renderWeeklyPartial({ language, buildTool, runnerProfile: 'solo' })
      expect(rendered).toContain('fuzz:')
      expect(rendered).toContain('soak-e2e:')
      expect(rendered).toContain('- fuzz')
      expect(rendered).toContain('- soak-e2e')
    },
  )

  it('solo: weekly-required needs includes fuzz + soak-e2e', () => {
    const rendered = renderWeeklyPartial({
      language: 'typescript',
      buildTool: 'npm',
      runnerProfile: 'solo',
    })
    const jobStart = rendered.indexOf('weekly-required:')
    const jobSlice = rendered.slice(jobStart)
    const needsMatch = jobSlice.match(/needs:\s*\n((?:\s+-[^\n]*\n?)*)/)
    expect(needsMatch).not.toBeNull()
    expect(needsMatch![1]).toContain('- fuzz')
    expect(needsMatch![1]).toContain('- soak-e2e')
  })

  // CRITICAL (B1): a failing fuzz/soak-e2e on solo must still hard-fail the
  // weekly gate (exit 1) — moving cadence must not silently drop enforcement.
  it('solo: weekly-required hard-fails (exit 1) when fuzz or soak-e2e fails', () => {
    const rendered = renderWeeklyPartial({
      language: 'typescript',
      buildTool: 'npm',
      runnerProfile: 'solo',
    })
    expect(rendered).toContain('needs.fuzz.result')
    expect(rendered).toContain('needs.soak-e2e.result')
    expect(rendered).toMatch(/exit 1/)
  })

  it('solo: "File issue on hard failures" if: is extended with fuzz/soak-e2e OR-terms', () => {
    const rendered = renderWeeklyPartial({
      language: 'typescript',
      buildTool: 'npm',
      runnerProfile: 'solo',
    })
    const fileIssueLine = rendered
      .split('\n')
      .find((l) => l.includes('File issue on hard failures'))
    expect(fileIssueLine).toBeDefined()
    const idx = rendered.indexOf('File issue on hard failures')
    const ifLine = rendered.slice(idx, idx + 400)
    expect(ifLine).toContain("needs.fuzz.result == 'failure'")
    expect(ifLine).toContain("needs.soak-e2e.result == 'failure'")
  })

  it('fleet: "File issue on hard failures" if: is NOT extended with fuzz/soak-e2e (unchanged)', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', buildTool: 'npm' })
    const idx = rendered.indexOf('File issue on hard failures')
    const ifLine = rendered.slice(idx, idx + 400)
    expect(ifLine).not.toContain('needs.fuzz.result')
    expect(ifLine).not.toContain('needs.soak-e2e.result')
  })

  it('runnerProfile=solo leaves no EJS tag leaks', () => {
    const rendered = renderWeeklyPartial({ runnerProfile: 'solo' })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})
