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

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('08-monthly.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)(
    '$language/$buildTool: workflow name is "Monthly (T5b)"',
    ({ language, buildTool }) => {
      const rendered = renderMonthly({ language, buildTool })
      expect(rendered).toContain('name: Monthly (T5b)')
    },
  )

  it.each(STACKS)(
    '$language/$buildTool: top-level permissions include contents: read and issues: write',
    ({ language, buildTool }) => {
      const rendered = renderMonthly({ language, buildTool })
      expect(rendered).toContain('contents: read')
      expect(rendered).toContain('issues: write')
    },
  )

  it.each(STACKS)('$language/$buildTool: dep-age-audit job present', ({ language, buildTool }) => {
    const rendered = renderMonthly({ language, buildTool })
    expect(rendered).toContain('dep-age-audit:')
  })

  it.each(STACKS)(
    '$language/$buildTool: license-full-audit job present',
    ({ language, buildTool }) => {
      const rendered = renderMonthly({ language, buildTool })
      expect(rendered).toContain('license-full-audit:')
    },
  )

  it.each(STACKS)(
    '$language/$buildTool: action-pins-stale-audit job present',
    ({ language, buildTool }) => {
      const rendered = renderMonthly({ language, buildTool })
      expect(rendered).toContain('action-pins-stale-audit:')
    },
  )

  it.each(STACKS)('$language/$buildTool: sbom-archive job present', ({ language, buildTool }) => {
    const rendered = renderMonthly({ language, buildTool })
    expect(rendered).toContain('sbom-archive:')
  })

  it.each(STACKS)(
    '$language/$buildTool: monthly-required gate job present',
    ({ language, buildTool }) => {
      const rendered = renderMonthly({ language, buildTool })
      expect(rendered).toContain('monthly-required:')
    },
  )

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

// ─── Per-language tool selection ──────────────────────────────────────────────

describe('08-monthly.yml.ejs — per-language tool selection', () => {
  it('typescript uses npm-check-updates + license-checker + npm sbom', () => {
    const rendered = renderMonthly({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('npm-check-updates')
    expect(rendered).toContain('license-checker')
    expect(rendered).toContain('npm sbom')
  })

  it('java/gradle uses dependencyUpdates + licenseReport + cyclonedxBom', () => {
    const rendered = renderMonthly({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('dependencyUpdates')
    expect(rendered).toContain('licenseReport')
    expect(rendered).toContain('cyclonedxBom')
  })

  it('java/maven uses versions:display-dependency-updates + license:aggregate + cyclonedx-maven-plugin', () => {
    const rendered = renderMonthly({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('versions:display-dependency-updates')
    expect(rendered).toContain('license:aggregate-third-party-report')
    expect(rendered).toContain('cyclonedx-maven-plugin')
  })

  it('go uses go list -u -m + go-licenses + anchore/sbom-action', () => {
    const rendered = renderMonthly({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('go list -u -m all')
    expect(rendered).toContain('go-licenses')
    expect(rendered).toContain('anchore/sbom-action')
  })

  it('python uses pip outdated + pip-licenses + cyclonedx-py', () => {
    const rendered = renderMonthly({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('pip list --outdated')
    expect(rendered).toContain('pip-licenses')
    expect(rendered).toContain('cyclonedx-py')
  })

  it('rust uses cargo-outdated + cargo-deny licenses + cargo-cyclonedx', () => {
    const rendered = renderMonthly({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo-outdated')
    expect(rendered).toContain('cargo deny check licenses')
    expect(rendered).toContain('cargo-cyclonedx')
  })
})

// ─── Action-pin staleness threshold ──────────────────────────────────────────

describe('08-monthly.yml.ejs — action-pin staleness', () => {
  it('action-pins-stale-audit threshold is 180 days', () => {
    const rendered = renderMonthly({})
    const section = rendered.split('action-pins-stale-audit:')[1] ?? ''
    const endOfSection = section.split('sbom-archive:')[0]
    expect(endOfSection).toContain('THRESHOLD_DAYS=180')
  })

  it('emits ::warning:: on stale pin', () => {
    const rendered = renderMonthly({})
    const section = rendered.split('action-pins-stale-audit:')[1] ?? ''
    expect(section).toContain('::warning::')
  })
})

// ─── Long-horizon artifact retention ─────────────────────────────────────────

describe('08-monthly.yml.ejs — long-horizon artifact retention', () => {
  it('artifacts have 365-day retention', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('retention-days: 365')
  })
})

// ─── Issue filing on failure ──────────────────────────────────────────────────

describe('08-monthly.yml.ejs — issue filing on failure', () => {
  it('files issue with monthly-regression label on failure', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('monthly-regression')
    expect(rendered).toContain('gh issue create')
  })

  it('issue filing runs only on failure', () => {
    const rendered = renderMonthly({})
    const issueSteps = rendered.split('if: failure()').length - 1
    expect(issueSteps).toBeGreaterThanOrEqual(1)
  })

  it('deduplicates by checking existing open issue first', () => {
    const rendered = renderMonthly({})
    expect(rendered).toContain('gh issue list')
    expect(rendered).toContain('--state open')
  })
})
