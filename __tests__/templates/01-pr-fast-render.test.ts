import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

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
