import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderNightly(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/06-nightly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('06-nightly.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "Nightly (T4)"', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('name: Nightly (T4)')
  })

  it.each(STACKS)(
    '$language: top-level permissions include contents: read and issues: write',
    ({ language, buildTool }) => {
      const rendered = renderNightly({ language, buildTool })
      expect(rendered).toContain('contents: read')
      expect(rendered).toContain('issues: write')
    },
  )

  it.each(STACKS)('$language: mutation-deep job present', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('mutation-deep:')
  })

  it.each(STACKS)('$language: dep-cve-refresh job present', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('dep-cve-refresh:')
  })

  it.each(STACKS)('$language: fuzz job present', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('fuzz:')
  })

  it.each(STACKS)('$language: soak-e2e job present', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('soak-e2e:')
  })

  it.each(STACKS)('$language: gitleaks-history job present', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('gitleaks-history:')
  })

  it.each(STACKS)('$language: evidence-collect job present', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('evidence-collect:')
    expect(rendered).toContain('retention-days: 90')
  })

  it.each(STACKS)('$language: nightly-required aggregator present', ({ language, buildTool }) => {
    const rendered = renderNightly({ language, buildTool })
    expect(rendered).toContain('nightly-required:')
    expect(rendered).toContain('if: always()')
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
})

// ─── Per-language mutation tools ──────────────────────────────────────────────

describe('06-nightly.yml.ejs — per-language mutation tools', () => {
  it('TypeScript: Stryker mutation', () => {
    const rendered = renderNightly({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('stryker run')
  })

  it('Java Gradle: PITest mutation', () => {
    const rendered = renderNightly({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('pitest')
  })

  it('Java Maven: PITest via Maven', () => {
    const rendered = renderNightly({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('pitest-maven:mutationCoverage')
  })

  it('Go: go-mutesting (informational)', () => {
    const rendered = renderNightly({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('go-mutesting')
  })

  it('Python: mutmut full run', () => {
    const rendered = renderNightly({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('mutmut run')
  })

  it('Rust: cargo-mutants full suite', () => {
    const rendered = renderNightly({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo mutants')
  })
})

// ─── Per-language CVE tools ───────────────────────────────────────────────────

describe('06-nightly.yml.ejs — per-language dep-CVE tools', () => {
  it('TypeScript: npm audit + osv-scanner', () => {
    const rendered = renderNightly({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('npm audit')
    expect(rendered).toContain('osv-scanner')
  })

  it('Java: OWASP Dependency-Check', () => {
    const rendered = renderNightly({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('Dependency-Check_Action')
  })

  it('Go: govulncheck', () => {
    const rendered = renderNightly({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('govulncheck-action')
  })

  it('Python: pip-audit', () => {
    const rendered = renderNightly({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('pip-audit')
  })

  it('Rust: cargo-audit', () => {
    const rendered = renderNightly({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo audit')
  })
})

// ─── Service archetype gating ─────────────────────────────────────────────────

describe('06-nightly.yml.ejs — service archetype gating', () => {
  it('service archetype: toxiproxy-resilience job present', () => {
    const rendered = renderNightly({ archetype: 'backend-web-db', language: 'typescript' })
    expect(rendered).toContain('toxiproxy-resilience:')
    expect(rendered).toContain('Toxiproxy')
  })

  it('service archetype: toxiproxy-resilience in nightly-required needs', () => {
    const rendered = renderNightly({ archetype: 'backend-web-db' })
    const aggregator = rendered.split('nightly-required:')[1] ?? ''
    expect(aggregator).toContain('toxiproxy-resilience')
  })

  it('library archetype: no toxiproxy-resilience job', () => {
    const rendered = renderNightly({ archetype: 'library' })
    expect(rendered).not.toContain('toxiproxy-resilience:')
  })

  it('cli archetype: no toxiproxy-resilience job', () => {
    const rendered = renderNightly({ archetype: 'cli' })
    expect(rendered).not.toContain('toxiproxy-resilience:')
  })

  it('service archetype: dast-full job present (not skipped)', () => {
    const rendered = renderNightly({ archetype: 'backend-web-db' })
    const dastSection = rendered.split('dast-full:')[1] ?? ''
    expect(dastSection).not.toContain('if: false')
  })

  it('library archetype: dast-full job skipped (if: false)', () => {
    const rendered = renderNightly({ archetype: 'library' })
    const dastSection = rendered.split('dast-full:')[1] ?? ''
    expect(dastSection).toContain('if: false')
  })
})

// ─── Gitleaks full history ────────────────────────────────────────────────────

describe('06-nightly.yml.ejs — gitleaks full history', () => {
  it('checkout with fetch-depth: 0 for full history', () => {
    const rendered = renderNightly({})
    const gitleaksSection = rendered.split('gitleaks-history:')[1] ?? ''
    expect(gitleaksSection).toContain('fetch-depth: 0')
  })

  it('gitleaks action with full-history log-opts', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('gitleaks-action@v2')
    expect(rendered).toContain('--full-history')
  })
})

// ─── Issue filing on failure ──────────────────────────────────────────────────

describe('06-nightly.yml.ejs — issue filing on regression', () => {
  it('nightly-required files issue with nightly-regression label', () => {
    const rendered = renderNightly({})
    expect(rendered).toContain('nightly-regression')
    expect(rendered).toContain('gh issue create')
  })
})
