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

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('07-weekly.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "Weekly (T5)"', ({ language, buildTool }) => {
    const rendered = renderWeekly({ language, buildTool })
    expect(rendered).toContain('name: Weekly (T5)')
  })

  it.each(STACKS)(
    '$language: top-level permissions include contents: read and issues: write',
    ({ language, buildTool }) => {
      const rendered = renderWeekly({ language, buildTool })
      expect(rendered).toContain('contents: read')
      expect(rendered).toContain('issues: write')
    },
  )

  it.each(STACKS)('$language: dep-freshness job present', ({ language, buildTool }) => {
    const rendered = renderWeekly({ language, buildTool })
    expect(rendered).toContain('dep-freshness:')
  })

  it.each(STACKS)('$language: perf-trend job present', ({ language, buildTool }) => {
    const rendered = renderWeekly({ language, buildTool })
    expect(rendered).toContain('perf-trend:')
    expect(rendered).toContain('k6')
  })

  it.each(STACKS)('$language: action-version-audit job present', ({ language, buildTool }) => {
    const rendered = renderWeekly({ language, buildTool })
    expect(rendered).toContain('action-version-audit:')
    expect(rendered).toContain('180')
  })

  it.each(STACKS)('$language: weekly-required aggregator present', ({ language, buildTool }) => {
    const rendered = renderWeekly({ language, buildTool })
    expect(rendered).toContain('weekly-required:')
    expect(rendered).toContain('if: always()')
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
})

// ─── Service archetype gating ─────────────────────────────────────────────────

describe('07-weekly.yml.ejs — service archetype gating', () => {
  it('service archetype: cross-db-matrix job present', () => {
    const rendered = renderWeekly({ archetype: 'backend-web-db' })
    expect(rendered).toContain('cross-db-matrix:')
  })

  it('service archetype: DB matrix includes postgres, mysql, mssql, mariadb', () => {
    const rendered = renderWeekly({ archetype: 'backend-web-db' })
    expect(rendered).toContain('postgres')
    expect(rendered).toContain('mysql')
    expect(rendered).toContain('mssql')
    expect(rendered).toContain('mariadb')
  })

  it('service archetype: cross-db-matrix in weekly-required needs', () => {
    const rendered = renderWeekly({ archetype: 'backend-web-db' })
    const aggregator = rendered.split('weekly-required:')[1] ?? ''
    expect(aggregator).toContain('cross-db-matrix')
  })

  it('library archetype: no cross-db-matrix job', () => {
    const rendered = renderWeekly({ archetype: 'library' })
    expect(rendered).not.toContain('cross-db-matrix:')
  })
})

// ─── CLI archetype gating ─────────────────────────────────────────────────────

describe('07-weekly.yml.ejs — cli archetype gating', () => {
  it('cli archetype: cross-os-matrix job present', () => {
    const rendered = renderWeekly({ archetype: 'cli', language: 'go', buildTool: 'go' })
    expect(rendered).toContain('cross-os-matrix:')
    expect(rendered).toContain('ubuntu-latest')
    expect(rendered).toContain('macos-latest')
    expect(rendered).toContain('windows-latest')
  })

  it('cli archetype: cross-os-matrix in weekly-required needs', () => {
    const rendered = renderWeekly({ archetype: 'cli' })
    const aggregator = rendered.split('weekly-required:')[1] ?? ''
    expect(aggregator).toContain('cross-os-matrix')
  })

  it('service archetype: no cross-os-matrix job', () => {
    const rendered = renderWeekly({ archetype: 'backend-web-db' })
    expect(rendered).not.toContain('cross-os-matrix:')
  })

  it('library archetype: no cross-os-matrix job', () => {
    const rendered = renderWeekly({ archetype: 'library' })
    expect(rendered).not.toContain('cross-os-matrix:')
  })
})

// ─── Per-language dep-freshness tools ────────────────────────────────────────

describe('07-weekly.yml.ejs — per-language dep-freshness', () => {
  it('TypeScript: npm outdated', () => {
    const rendered = renderWeekly({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('npm outdated')
  })

  it('Java Gradle: dependencyUpdates', () => {
    const rendered = renderWeekly({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('dependencyUpdates')
  })

  it('Java Maven: versions:display-dependency-updates', () => {
    const rendered = renderWeekly({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('versions:display-dependency-updates')
  })

  it('Go: go list -u -m all', () => {
    const rendered = renderWeekly({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('go list -u -m all')
  })

  it('Python: pip-review', () => {
    const rendered = renderWeekly({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('pip-review')
  })

  it('Rust: cargo-outdated', () => {
    const rendered = renderWeekly({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo outdated')
  })
})

// ─── Issue filing on failure ──────────────────────────────────────────────────

describe('07-weekly.yml.ejs — issue filing on regression', () => {
  it('weekly-required files issue with weekly-regression label', () => {
    const rendered = renderWeekly({})
    expect(rendered).toContain('weekly-regression')
    expect(rendered).toContain('gh issue create')
  })
})
