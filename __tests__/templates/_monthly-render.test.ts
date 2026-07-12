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

// #1803: sbom (and license-full-audit, same file/class) were 2 of the 3/8
// workflow dims relying on an unverified JVM-shared EJS branch for kotlin.
// `language === 'java'` never matches 'kotlin', so both jobs fell through to
// checkout-only (sbom-archive) or the upload-artifact-with-no-file warn path.
// Gradle/Maven CycloneDX + license-report plugins operate on the build's
// dependency graph, not the source language, so kotlin now shares the java
// arm in both jobs (same fix shape as the already-fixed fuzz job).
describe('_monthly.yml.ejs — kotlin sbom + license-full-audit coverage (#1803)', () => {
  it.each(['gradle', 'maven'] as const)(
    'kotlin/%s: sbom-archive shares the java/JVM CycloneDX branch, not checkout-only',
    (buildTool) => {
      const rendered = renderMonthlyPartial({ language: 'kotlin', buildTool })
      const jobStart = rendered.indexOf('sbom-archive:')
      const jobEnd = rendered.indexOf('evidence-collect:')
      const section = rendered.slice(jobStart, jobEnd)
      expect(section).toContain('setup-java')
      expect(section).toContain(buildTool === 'gradle' ? 'cyclonedxBom' : 'cyclonedx-maven-plugin')
    },
  )

  it.each(['gradle', 'maven'] as const)(
    'kotlin/%s: license-full-audit shares the java/JVM license-report branch, not checkout-only',
    (buildTool) => {
      const rendered = renderMonthlyPartial({ language: 'kotlin', buildTool })
      const jobStart = rendered.indexOf('license-full-audit:')
      const jobEnd = rendered.indexOf('action-pins-stale-audit:')
      const section = rendered.slice(jobStart, jobEnd)
      expect(section).toContain('setup-java')
      expect(section).toContain(
        buildTool === 'gradle' ? 'licenseReport' : 'aggregate-third-party-report',
      )
    },
  )

  it('kotlin leaves no EJS tag leaks', () => {
    const rendered = renderMonthlyPartial({ language: 'kotlin', buildTool: 'gradle' })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})
