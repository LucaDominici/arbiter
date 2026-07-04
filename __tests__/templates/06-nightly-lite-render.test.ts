// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderNightlyLite(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/06-nightly-lite.yml.ejs',
    makeConfig('/tmp/test', {
      collaborationMode: 'trunk-solo',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('06-nightly-lite.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)(
    '$language: workflow name is "Nightly Lite (T4-lite)"',
    ({ language, buildTool }) => {
      const rendered = renderNightlyLite({ language, buildTool })
      expect(rendered).toContain('name: Nightly Lite (T4-lite)')
    },
  )

  it.each(STACKS)('$language: has on: section', ({ language, buildTool }) => {
    const rendered = renderNightlyLite({ language, buildTool })
    expect(rendered).toMatch(/^on:/m)
  })

  it.each(STACKS)('$language: has jobs: section', ({ language, buildTool }) => {
    const rendered = renderNightlyLite({ language, buildTool })
    expect(rendered).toMatch(/^jobs:/m)
  })

  it.each(STACKS)('$language: integration job present', ({ language, buildTool }) => {
    const rendered = renderNightlyLite({ language, buildTool })
    expect(rendered).toContain('integration')
  })

  it.each(STACKS)('$language: NO mutation job', ({ language, buildTool }) => {
    const rendered = renderNightlyLite({ language, buildTool })
    expect(rendered).not.toContain('mutation-deep:')
  })

  it.each(STACKS)('$language: NO SLSA/cosign job', ({ language, buildTool }) => {
    const rendered = renderNightlyLite({ language, buildTool })
    expect(rendered).not.toContain('slsa-')
    expect(rendered).not.toContain('cosign attest')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderNightlyLite({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Action pinning (#1319.5) ─────────────────────────────────────────────────
// NO existing gate covers TEMPLATE action pins (check-workflow-sha-pinning /
// check-action-pins / sync-action-pins only scan self .github/). This render-assert
// is the SOLE enforcement that 06-nightly-lite's govulncheck is SHA-pinned, not @v1.

describe('06-nightly-lite.yml.ejs — action pinning (#1319.5)', () => {
  it('go: govulncheck-action is SHA-pinned (not @v1)', () => {
    const rendered = renderNightlyLite({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('golang/govulncheck-action@')
    // Must be pinned to a full 40-char commit SHA, never a floating @v1 tag.
    expect(rendered).not.toMatch(/golang\/govulncheck-action@v\d/)
    expect(rendered).toMatch(/golang\/govulncheck-action@[0-9a-f]{40}\b/)
  })
})

// ─── Runner fallback (#1770, #1756) ──────────────────────────────────────────
// gated-review + L3Plus must NEVER render a bare self-hosted default: an outsider
// repo without CI_BUILD_RUNNER_LABEL set would queue forever on docker-ci-build.

describe('06-nightly-lite.yml.ejs — runner fallback (#1770, #1756)', () => {
  it('gated-review + L3 falls back to ubuntu-latest, not docker-ci-build', () => {
    const rendered = renderNightlyLite({ collaborationMode: 'gated-review', governanceLevel: 'L3' })
    expect(rendered).not.toContain("'docker-ci-build'")
    expect(rendered).toContain("vars.CI_BUILD_RUNNER_LABEL || 'ubuntu-latest'")
  })
})

// ─── Schedule and triggers ────────────────────────────────────────────────────

describe('06-nightly-lite.yml.ejs — schedule', () => {
  it('cron schedule present', () => {
    const rendered = renderNightlyLite({})
    expect(rendered).toContain('cron:')
  })

  it('workflow_dispatch trigger present', () => {
    const rendered = renderNightlyLite({})
    expect(rendered).toContain('workflow_dispatch:')
  })

  it('cancel-in-progress: false (no mid-run cancellation)', () => {
    const rendered = renderNightlyLite({})
    expect(rendered).toContain('cancel-in-progress: false')
  })
})
