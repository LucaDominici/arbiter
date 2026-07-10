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

  it('weekly delegates to shared-security partial with no inputs (#1694, R-07)', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('shared-security:')
    expect(rendered).not.toContain('nvd-cache-namespace')
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

// Weekly (T5) was red on 5 consecutive scheduled runs (run 28730540157 et al.):
// (a) `date: invalid option -- 'j'` — the BSD/macOS `date -j` fallback is
//     unconditionally invalid on our GNU/Linux runners (#1785: even a literal
//     `ubuntu-latest` label routes to self-hosted Linux here), and is reached
//     whenever the primary GNU `date -d` parse fails (e.g. an odd commit-date
//     API response) — crashing the whole audit job under `set -e`.
// (b) `could not add label: 'weekly-regression' not found` — labels.yml/
//     _label-sync.yml own the canonical label, but a not-yet-synced repo has
//     no such label, and `gh issue create --label` hard-fails.
describe('_weekly.yml.ejs — stale-pin-audit portability + label self-heal (weekly red streak)', () => {
  it('does not use the BSD/macOS-only `date -j` fallback anywhere', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('date -j')
    expect(rendered).not.toContain('date -v')
  })

  it('a failed commit-date parse is skipped (continue), not left to crash the job', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', buildTool: 'npm' })
    const idx = rendered.indexOf('PUSHED_EPOCH=')
    expect(idx).toBeGreaterThan(-1)
    const slice = rendered.slice(idx, idx + 300)
    expect(slice).toContain('continue')
  })

  it('"File issue on hard failures" idempotently creates the weekly-regression label before use', () => {
    const rendered = renderWeeklyPartial({ language: 'typescript', buildTool: 'npm' })
    const idx = rendered.indexOf('File issue on hard failures')
    expect(idx).toBeGreaterThan(-1)
    const slice = rendered.slice(idx, idx + 1100)
    const labelCreateIdx = slice.indexOf('gh label create weekly-regression')
    const issueCreateIdx = slice.indexOf('gh issue create')
    expect(labelCreateIdx).toBeGreaterThan(-1)
    expect(issueCreateIdx).toBeGreaterThan(labelCreateIdx)
    // Must never crash the step when the label already exists.
    expect(slice.slice(labelCreateIdx, labelCreateIdx + 200)).toContain('|| true')
  })
})
