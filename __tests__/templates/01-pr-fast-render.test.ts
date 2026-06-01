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
