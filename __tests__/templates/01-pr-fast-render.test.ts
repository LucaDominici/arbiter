import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// Self-host render context (ciPreTestBuild=true) — the same fixture the
// ci-tier render-parity suite bakes arbiter's own .github/workflows from.
const CI_CTX = JSON.parse(
  readFileSync(new URL('../fixtures/ci-tier-render-context.json', import.meta.url), 'utf-8'),
)
function renderSelfHost(overrides: Record<string, unknown> = {}): string {
  return renderTemplate('github/workflows/01-pr-fast.yml.ejs', { ...CI_CTX, ...overrides })
}

// #1131 slice 2: 01-pr-fast is the most-rewired workflow (setup-node + npm ci
// pairs → the setup-node-pnpm composite). It had no render test; this is the
// CANON-18 safety net for the composite reference + EJS language guards.

function render(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/01-pr-fast.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('01-pr-fast.yml.ejs — structural invariants (CANON-18, #1131)', () => {
  const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const

  it.each(LEVELS)('typescript %s: workflow name is "PR Fast (T1)"', (governanceLevel) => {
    expect(render({ language: 'typescript', governanceLevel })).toContain('name: PR Fast (T1)')
  })

  it.each(LEVELS)(
    'typescript %s: setup+install uses the composite, not inline actions/setup-node + npm ci',
    (governanceLevel) => {
      const rendered = render({ language: 'typescript', governanceLevel })
      expect(rendered).toContain('uses: ./.github/actions/setup-node-pnpm')
      // The test-suite jobs must not re-declare the inline setup-node+npm-ci pair.
      expect(rendered).not.toMatch(/cache: 'npm'\n\s+- run: npm ci/)
    },
  )

  it('typescript: the 2 node-only jobs keep a bare setup-node (no forced npm ci)', () => {
    // security-early-fail (PII scan) + classify-changes run node scripts without
    // installing deps — they intentionally stay on inline bare setup-node.
    const rendered = render({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toContain('actions/setup-node@')
  })

  it.each(['java', 'go', 'python', 'rust'] as const)(
    '%s: does NOT reference the node composite (uses its own toolchain setup)',
    (language) => {
      const buildTool = language === 'java' ? 'gradle' : language === 'python' ? 'pip' : language
      const rendered = render({ language, buildTool })
      expect(rendered).not.toContain('uses: ./.github/actions/setup-node-pnpm')
    },
  )

  it('renders the ci-required aggregator and the INV-74 human-approval gate', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toContain('ci-required:')
    expect(rendered).toContain('approved-by-human')
  })

  // #1512 gold-align: the lightweight *ArchTest architecture rules run BLOCKING on
  // every PR for Java L2+ (not only the weekly 13-archunit-extended cron). The heavier
  // *ModulesTest stays on the cron — the per-PR job must NOT run it.
  it.each(['L2', 'L3', 'L4'] as const)('java %s: runs *ArchTest blocking per-PR', (level) => {
    const rendered = render({ language: 'java', buildTool: 'gradle', governanceLevel: level })
    expect(rendered).toContain('ArchUnit Architecture Tests (Java)')
    expect(rendered).toContain('*ArchTest')
    expect(rendered).not.toContain('*ModulesTest')
  })

  it('java L1: does NOT run the per-PR ArchTest job', () => {
    const rendered = render({ language: 'java', buildTool: 'gradle', governanceLevel: 'L1' })
    expect(rendered).not.toContain('ArchUnit Architecture Tests (Java)')
  })

  it('java maven L2: runs *ArchTest via surefire per-PR', () => {
    const rendered = render({ language: 'java', buildTool: 'maven', governanceLevel: 'L2' })
    expect(rendered).toContain('ArchUnit Architecture Tests (Java)')
    expect(rendered).toContain('-Dtest="*ArchTest"')
  })

  it('java L2+: the per-PR ArchTest lane is a BLOCKING required check (ci-required)', () => {
    const rendered = render({ language: 'java', buildTool: 'gradle', governanceLevel: 'L3' })
    expect(rendered).toContain('needs.archunit-tests.result')
    expect(rendered).toMatch(/needs: \[[^\]]*archunit-tests/)
  })
})

// #1227 — Parallelization assertions (ADR-090: chain ≤ 3, parallel after gate)
// Red phase: these tests FAIL before the needs: [unit-tests] → needs: [gate] fix.
describe('01-pr-fast.yml.ejs — DAG parallelism (#1227, ADR-090)', () => {
  // TypeScript path: integration-tests and behavioral-tests must depend on gate,
  // not on unit-tests. Serial chain gate→unit→integration is a 4-step critical path.
  it('typescript L2: integration-tests depends on gate, not unit-tests', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    // Must NOT have needs: [unit-tests] for integration-tests job
    expect(rendered).not.toMatch(/integration-tests:[\s\S]*?needs:\s*\[unit-tests\]/)
    // Must have needs: [gate] instead
    expect(rendered).toMatch(/integration-tests:[\s\S]{0,200}?needs:\s*\[gate, classify-changes\]/)
  })

  it('typescript L2: behavioral-tests depends on gate, not unit-tests', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    // Must NOT have needs: [unit-tests] for behavioral-tests job
    expect(rendered).not.toMatch(/behavioral-tests:[\s\S]*?needs:\s*\[unit-tests\]/)
    // Must have needs: [gate] instead
    expect(rendered).toMatch(/behavioral-tests:[\s\S]{0,200}?needs:\s*\[gate, classify-changes\]/)
  })

  // Java path: same serial chain fix required
  it('java gradle L2: integration-tests depends on gate, not unit-tests', () => {
    const rendered = render({ language: 'java', buildTool: 'gradle', governanceLevel: 'L2' })
    expect(rendered).not.toMatch(/integration-tests:[\s\S]*?needs:\s*\[unit-tests\]/)
    expect(rendered).toMatch(/integration-tests:[\s\S]{0,200}?needs:\s*\[gate, classify-changes\]/)
  })

  it('java gradle L2: behavioral-tests depends on gate, not unit-tests', () => {
    const rendered = render({ language: 'java', buildTool: 'gradle', governanceLevel: 'L2' })
    expect(rendered).not.toMatch(/behavioral-tests:[\s\S]*?needs:\s*\[unit-tests\]/)
    expect(rendered).toMatch(/behavioral-tests:[\s\S]{0,200}?needs:\s*\[gate, classify-changes\]/)
  })

  // Parallel jobs count: after the fix, gate has ≥3 direct dependents (unit, integration, behavioral)
  it('typescript L2: gate has at least 3 parallel direct dependents', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    // Count job blocks that depend directly on gate (gate as first need; some also add classify-changes)
    const needsGateMatches = rendered.match(/needs:\s*\[gate[,\]]/g)
    expect(needsGateMatches).not.toBeNull()
    expect((needsGateMatches ?? []).length).toBeGreaterThanOrEqual(3)
  })

  // strategy.max-parallel: 2 — acceptance criterion from issue #1227 (evita saturare runner)
  it('typescript L2: unit-tests job has strategy.max-parallel: 2', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(rendered).toMatch(/unit-tests:[\s\S]{0,200}?strategy:\s*\n\s+max-parallel:\s*2/)
  })

  it('typescript L2: integration-tests job has strategy.max-parallel: 2', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(rendered).toMatch(/integration-tests:[\s\S]{0,200}?strategy:\s*\n\s+max-parallel:\s*2/)
  })

  it('typescript L2: behavioral-tests job has strategy.max-parallel: 2', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(rendered).toMatch(/behavioral-tests:[\s\S]{0,200}?strategy:\s*\n\s+max-parallel:\s*2/)
  })

  it('java gradle L2: unit-tests job has strategy.max-parallel: 2', () => {
    const rendered = render({ language: 'java', buildTool: 'gradle', governanceLevel: 'L2' })
    expect(rendered).toMatch(/unit-tests:[\s\S]{0,200}?strategy:\s*\n\s+max-parallel:\s*2/)
  })
})

// PORT E1 (#1502) — slim the ALWAYS (PR) path; move heavy tools to nightly.
// Each move keeps the tool RUNNING at a different cadence and preserves the
// governance floor (coverage threshold stays enforced by gate-full's check-all L2
// on PR; OWASP DC + full sonar + full-repo CPD move to nightly).
describe('01-pr-fast.yml.ejs — PR-path slimming (E1, #1502)', () => {
  function debtGatesSection(rendered: string): string {
    return (rendered.split('debt-gates:')[1] ?? '').split('\n  sonar-scan:')[0]
  }

  it('(c) debt-gates no longer re-runs the full coverage suite (TS)', () => {
    const section = debtGatesSection(render({ language: 'typescript', governanceLevel: 'L2' }))
    // the redundant whole-suite coverage re-run is gone (gate-full's check-all L2
    // already enforces the threshold on PR) ...
    expect(section).not.toContain('--coverage.thresholds.lines')
    // ... but the fast static-analysis legs stay on PR
    expect(section).toContain('npx knip')
    expect(section).toContain('madge --circular')
  })

  it('(c) debt-gates keeps fast static analysis but drops the coverage re-run (per language)', () => {
    const rust = debtGatesSection(
      render({ language: 'rust', buildTool: 'cargo', governanceLevel: 'L3' }),
    )
    expect(rust).not.toContain('cargo tarpaulin')
    expect(rust).toContain('clippy::pedantic')

    const go = debtGatesSection(render({ language: 'go', buildTool: 'go', governanceLevel: 'L3' }))
    expect(go).not.toContain('-coverprofile')
    expect(go).toContain('golangci-lint run --enable')

    const py = debtGatesSection(
      render({ language: 'python', buildTool: 'pip', governanceLevel: 'L3' }),
    )
    expect(py).not.toContain('--cov-fail-under')
    expect(py).toContain('C901,PLR0911')

    const javaGradle = debtGatesSection(
      render({ language: 'java', buildTool: 'gradle', governanceLevel: 'L3' }),
    )
    expect(javaGradle).not.toContain('jacocoTestCoverageVerification')
    expect(javaGradle).toContain('pmdMain')
    expect(javaGradle).toContain('spotbugsMain')
  })

  it('(d) the slow OWASP Dependency-Check is off the PR java gate (moved to nightly)', () => {
    const gradle = render({ language: 'java', buildTool: 'gradle', governanceLevel: 'L2' })
    expect(gradle).not.toContain('dependencyCheckAnalyze')
    const maven = render({ language: 'java', buildTool: 'maven', governanceLevel: 'L2' })
    expect(maven).not.toContain('org.owasp:dependency-check-maven')
  })

  it('(d) fast PR dep audits remain on PR for the languages that have one', () => {
    expect(render({ language: 'typescript', governanceLevel: 'L2' })).toContain(
      'npm audit --omit=dev',
    )
    expect(render({ language: 'go', governanceLevel: 'L2' })).toContain('govulncheck-action')
    expect(render({ language: 'rust', buildTool: 'cargo', governanceLevel: 'L2' })).toContain(
      'rustsec/audit-check',
    )
  })

  it('(a) PR sonar-scan does incremental PR decoration, not a full scan', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    const sonar = (rendered.split('sonar-scan:')[1] ?? '').split('\n  debt-ratchet:')[0]
    expect(sonar).toContain('sonar.pullrequest.key')
    expect(sonar).toContain("github.event_name == 'pull_request'")
  })
})

// PORT E2 (#1500/#1502) — wire the build-cache composite into the build/test
// graph. A single build-workspace `save` job builds the node-workspace once; the
// downstream test jobs `restore` it (non-blocking rebuild fallback) instead of
// each re-running `npm run build`. The self-host (ciPreTestBuild) path is the
// only pr-fast case whose test jobs build — so the wiring is gated on it there.
describe('01-pr-fast.yml.ejs — build-cache wiring (E2, #1500)', () => {
  it('self-host: a build-workspace job saves the workspace via the build-cache action', () => {
    const rendered = renderSelfHost()
    expect(rendered).toContain('build-workspace:')
    expect(rendered).toContain('uses: ./.github/actions/build-cache')
    // The save op lives in the build-workspace job.
    const bw = (rendered.split('build-workspace:')[1] ?? '').split('\n  gate:')[0]
    expect(bw).toContain('op: save')
    expect(bw).toContain('timeout-minutes: 60')
  })

  it('self-host: test jobs restore the cache instead of re-running npm run build', () => {
    const rendered = renderSelfHost()
    // Each of the 4 test jobs replaced its inline `npm run build && build-kit`
    // prefix with a restore step (build-kit still runs, fed by restored/rebuilt dist).
    const unit = (rendered.split('  unit-tests:')[1] ?? '').split('\n  contract-tests:')[0]
    expect(unit).toContain('op: restore')
    expect(unit).not.toContain('npm run build && node scripts/build-kit.mjs')
    // unit-tests now depends on build-workspace.
    expect(rendered).toMatch(/unit-tests:[\s\S]{0,260}?needs:\s*\[gate, build-workspace, /)
  })

  it('self-host: the non-blocking rebuild fallback is preserved (action carries it)', () => {
    // restore is wired; the action itself guarantees the rebuild fallback, but the
    // workflow must reference it via op: restore (not an inline unconditional build).
    expect(renderSelfHost()).toContain('op: restore')
  })

  it('adversarial: a generic project (no ciPreTestBuild) is unchanged — no build-workspace', () => {
    const generic = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(generic).not.toContain('build-workspace:')
    expect(generic).not.toContain('op: save')
  })
})

// PORT A1 (#1502) — fast PR supply-chain + IaC.
// (a) actions/dependency-review-action as a PR-time supply-chain gate, at the
//     enableSecurityScanning floor (matches security-early-fail's always-path gating).
// (b) An IaC scan (checkov) that CONSUMES the previously-classified-but-unused
//     `infra_changed` output, gated on infra_changed == 'true'.
describe('01-pr-fast.yml.ejs — PR supply-chain + IaC (A1, #1502)', () => {
  // Capture a job block: from the job header to the next 2-space job header
  // (\n  <name>:) — body lines are 4-space indented so they are not split points.
  function jobSection(rendered: string, job: string): string {
    return (rendered.split(`  ${job}:`)[1] ?? '').split(/\n {2}(?=\S)/)[0]
  }
  const depReviewSection = (r: string) => jobSection(r, 'dependency-review')
  const iacSection = (r: string) => jobSection(r, 'iac-scan')

  it('(a) dependency-review is a PR-only, SHA-pinned supply-chain gate at L2', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(rendered).toContain('  dependency-review:')
    const section = depReviewSection(rendered)
    // PR-only: the action diffs base...head and errors on push.
    expect(section).toContain("if: github.event_name == 'pull_request'")
    // SHA-pinned (INV-76) with a version comment.
    expect(rendered).toMatch(/uses: actions\/dependency-review-action@[0-9a-f]{40}\s+# v\d/)
    // Configurable fail severity, defaulting to high.
    expect(section).toContain('fail-on-severity:')
    expect(section).toContain("'high'")
    // Hardening: timeout-minutes present.
    expect(section).toContain('timeout-minutes: 60')
  })

  it('(a) dependency-review respects the security-scanning floor (absent at L1 starter)', () => {
    const l1 = render({ language: 'typescript', governanceLevel: 'L1' })
    expect(l1).not.toContain('  dependency-review:')
    // present once enableSecurityScanning is on (its always-path gate)
    const l1sec = render({
      language: 'typescript',
      governanceLevel: 'L1',
      enableSecurityScanning: true,
    } as Record<string, unknown>)
    expect(l1sec).toContain('  dependency-review:')
  })

  it('(a) dependency-review is wired into the ci-required aggregator', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(rendered).toMatch(/needs: \[[^\]]*dependency-review/)
    expect(rendered).toContain('needs.dependency-review.result')
  })

  it('(b) iac-scan consumes infra_changed and is a SHA-pinned checkov scan', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(rendered).toContain('  iac-scan:')
    const section = iacSection(rendered)
    expect(section).toContain('needs: [classify-changes]')
    expect(section).toContain("if: needs.classify-changes.outputs.infra_changed == 'true'")
    // checkov, SHA-pinned, scanning terraform/k8s/dockerfile.
    expect(rendered).toMatch(/uses: bridgecrewio\/checkov-action@[0-9a-f]{40}\s+# v\d/)
    expect(section).toContain('terraform')
    expect(section).toContain('kubernetes')
    expect(section).toContain('dockerfile')
    expect(section).toContain('timeout-minutes: 60')
  })

  it('(b) iac-scan runs a SHA-pinned, blocking tflint Terraform linter (#1509)', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    const section = iacSection(rendered)
    // tflint setup action SHA-pinned with a version comment.
    expect(section).toMatch(/uses: terraform-linters\/setup-tflint@[0-9a-f]{40}\s+# v\d/)
    // Blocking lint invocation (no soft-fail / continue-on-error on the tflint run).
    expect(section).toMatch(/tflint --recursive/)
    expect(section).not.toContain('continue-on-error')
  })

  it('(b) iac-scan is absent at L1 single-lane (no classify-changes signal)', () => {
    const l1 = render({ language: 'typescript', governanceLevel: 'L1' })
    expect(l1).not.toContain('  iac-scan:')
    // but present at L2 where classify-changes runs
    expect(render({ language: 'typescript', governanceLevel: 'L2' })).toContain('  iac-scan:')
  })

  it('(b) iac-scan is wired into the ci-required aggregator', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L2' })
    expect(rendered).toMatch(/needs: \[[^\]]*iac-scan/)
    expect(rendered).toContain('needs.iac-scan.result')
  })

  it('adversarial: both new jobs preserve the language-agnostic floor (java L3 gated)', () => {
    const rendered = render({
      language: 'java',
      buildTool: 'maven',
      governanceLevel: 'L3',
    })
    expect(rendered).toContain('  dependency-review:')
    expect(rendered).toContain('  iac-scan:')
  })
})

// #1296 — CI Required on docs-only PRs: skipped code jobs are accepted ONLY when
// the docs_only classification skipped them; classify-changes itself must succeed.
describe('ci-required — docs-only skip acceptance (#1296)', () => {
  it('L3: accepts skipped via the DOCS_ONLY guard and requires classify success', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toContain('DOCS_ONLY:')
    expect(rendered).toMatch(/ok\(\)\s*\{/)
    // strict classify check — an errored classification fails the aggregator
    expect(rendered).toMatch(/needs\.classify-changes\.result }}" != "success"/)
    // no remaining bare strict check for the docs-gated jobs
    expect(rendered).not.toMatch(/needs\.unit-tests\.result }}" != "success" \]\]/)
  })

  it('L1 single-lane (no classify job): stays strict, no dangling classify refs', () => {
    const rendered = render({ language: 'typescript', governanceLevel: 'L1' })
    if (!rendered.includes('classify-changes:')) {
      expect(rendered).not.toContain('DOCS_ONLY:')
      expect(rendered).not.toContain('needs.classify-changes.result')
    }
  })

  it('java+maven: build-reactor check also accepts docs-only skips', () => {
    const rendered = render({ language: 'java', buildTool: 'maven', governanceLevel: 'L3' })
    if (rendered.includes('build-reactor')) {
      expect(rendered).not.toMatch(/needs\.build-reactor\.result }}" != "success" \]\]/)
    }
  })
})
