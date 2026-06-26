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

  // #1086: the upstream shopify/toxiproxy-github-action repo was deleted (404),
  // so the service-archetype resilience job must not reference the dead action;
  // it pins + runs the official toxiproxy-server release binary instead.
  it('service archetype: no dead toxiproxy action; uses pinned server binary', () => {
    const rendered = renderNightly({ archetype: 'backend-web-db' })
    expect(rendered).toContain('toxiproxy-resilience:')
    expect(rendered).not.toContain('shopify/toxiproxy-github-action')
    expect(rendered).toContain('releases/download/v2.12.0/toxiproxy-server-linux-amd64')
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

  it('TypeScript: osv-scanner-action uses a 40-char SHA pin (INV-76)', () => {
    // Regression guard for #858: google/osv-scanner-action@v2 does not exist.
    // The action ref MUST be a full 40-character commit SHA, not a tag like @v2.
    const rendered = renderNightly({ language: 'typescript', buildTool: 'npm' })
    const SHA_RE = /google\/osv-scanner-action\/osv-scanner-action@([0-9a-f]{40})/i
    expect(rendered).toMatch(SHA_RE)
  })

  it('committed 06-nightly.yml: osv-scanner-action uses a 40-char SHA pin (INV-76)', () => {
    // Ensures the committed workflow file (the one that actually runs in CI)
    // also references a valid pinned SHA — not the broken @v2 tag.
    const wfPath = join(ROOT, '.github', 'workflows', '06-nightly.yml')
    const content = readFileSync(wfPath, 'utf-8')
    const SHA_RE = /google\/osv-scanner-action\/osv-scanner-action@([0-9a-f]{40})/i
    expect(content).toMatch(SHA_RE)
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

  // E4 (#1502): the PR-path dast-baseline consolidated here — dast-full now starts
  // the app so the full active scan has a live target (it previously pointed at
  // localhost:8080 with nothing running).
  it('service archetype: dast-full starts the app (docker compose up)', () => {
    const rendered = renderNightly({ archetype: 'backend-web-db' })
    const dastSection = (rendered.split('dast-full:')[1] ?? '').split('load-smoke:')[0]
    expect(dastSection).toContain('docker compose up -d --wait')
    expect(dastSection).toContain('docker compose down')
  })
})

// ─── PORT E4 (#1502): load-smoke moved off the PR path to nightly cadence ──────

describe('06-nightly.yml.ejs — E4 load-smoke (#1502)', () => {
  it('service archetype: load-smoke job present (k6, nightly cadence)', () => {
    const rendered = renderNightly({ archetype: 'backend-web-db' })
    expect(rendered).toContain('load-smoke:')
    expect(rendered).toContain('k6 run')
  })

  it('service archetype: load-smoke wired into the nightly-required gate needs', () => {
    const rendered = renderNightly({ archetype: 'backend-web-db' })
    const gate = rendered.split('nightly-required:')[1] ?? ''
    expect(gate).toContain('load-smoke')
  })

  it('library archetype: no load-smoke job', () => {
    const rendered = renderNightly({ archetype: 'library' })
    expect(rendered).not.toContain('load-smoke:')
  })

  it('cli archetype: no load-smoke job', () => {
    const rendered = renderNightly({ archetype: 'cli' })
    expect(rendered).not.toContain('load-smoke:')
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
    expect(rendered).toMatch(/gitleaks-action@[0-9a-f]{40}/)
    expect(rendered).toContain('--full-history')
  })
})

// ─── PORT E1 (#1502): tools moved off the PR path land here ───────────────────

describe('06-nightly.yml.ejs — E1 moved-in heavy tools (#1502)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  it.each(STACKS)(
    '$language/$buildTool: coverage-report job present (moved from PR debt-gates)',
    ({ language, buildTool }) => {
      const rendered = renderNightly({ language, buildTool })
      expect(rendered).toContain('coverage-report:')
    },
  )

  it('typescript: duplication-baseline job present (full-repo jscpd)', () => {
    const rendered = renderNightly({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('duplication-baseline:')
    expect(rendered).toContain('scripts/check-duplication.mjs')
  })

  it.each(STACKS.filter((s) => s.language !== 'typescript'))(
    '$language/$buildTool: no jscpd duplication-baseline (native CPD instead)',
    ({ language, buildTool }) => {
      const rendered = renderNightly({ language, buildTool })
      expect(rendered).not.toContain('duplication-baseline:')
      // and the aggregator must not dangle a ref to the absent job
      expect(rendered).not.toContain('needs.duplication-baseline.result')
    },
  )

  it('(a) sonar-deep-scan job present with a full branch analysis', () => {
    const rendered = renderNightly({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('sonar-deep-scan:')
    // full analysis: no pullrequest decoration params in the nightly deep scan
    const sonar = (rendered.split('sonar-deep-scan:')[1] ?? '').split('\n  evidence-collect:')[0]
    expect(sonar).not.toContain('sonar.pullrequest')
  })

  it('coverage-report + duplication-baseline are gated by nightly-required', () => {
    const rendered = renderNightly({ language: 'typescript', buildTool: 'npm' })
    const aggregator = rendered.split('nightly-required:')[1] ?? ''
    expect(aggregator).toContain('coverage-report')
    expect(aggregator).toContain('duplication-baseline')
  })

  it('moved-in jobs carry timeout-minutes (workflow hardening)', () => {
    const rendered = renderNightly({ language: 'typescript', buildTool: 'npm' })
    for (const job of ['coverage-report:', 'duplication-baseline:', 'sonar-deep-scan:']) {
      // job header to the start of its `steps:` block — timeout-minutes lives in
      // the job preamble (name/runs-on/timeout-minutes), before steps.
      const afterHeader = rendered.split(`\n  ${job}`)[1] ?? ''
      const preamble = afterHeader.split('\n    steps:')[0]
      expect(preamble, `${job} must declare timeout-minutes`).toContain('timeout-minutes:')
    }
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
