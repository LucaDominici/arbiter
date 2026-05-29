// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderCodeql(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/15-codeql.yml.ejs',
    makeConfig('/tmp/test', {
      collaborationMode: 'peer-review',
      governanceLevel: 'L2',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('15-codeql.yml.ejs — structural invariants (CANON-18)', () => {
  // Rust excluded: CodeQL has no native Rust support; generator skips 15-codeql for Rust projects
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
  ] as const

  const LEVELS = ['L2', 'L3', 'L4'] as const

  it.each(STACKS)('$language: workflow name contains "CodeQL"', ({ language, buildTool }) => {
    const rendered = renderCodeql({ language, buildTool })
    expect(rendered).toContain('CodeQL')
  })

  it.each(STACKS)('$language: has on: section', ({ language, buildTool }) => {
    const rendered = renderCodeql({ language, buildTool })
    expect(rendered).toMatch(/^on:/m)
  })

  it.each(STACKS)('$language: has jobs: section', ({ language, buildTool }) => {
    const rendered = renderCodeql({ language, buildTool })
    expect(rendered).toMatch(/^jobs:/m)
  })

  it.each(STACKS)('$language: security-events: write permission', ({ language, buildTool }) => {
    const rendered = renderCodeql({ language, buildTool })
    expect(rendered).toContain('security-events: write')
  })

  it.each(STACKS)('$language: uses codeql-action', ({ language, buildTool }) => {
    const rendered = renderCodeql({ language, buildTool })
    expect(rendered).toContain('codeql-action')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderCodeql({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Trigger guard ────────────────────────────────────────────────────────────

describe('15-codeql.yml.ejs — triggers', () => {
  it('push trigger present', () => {
    const rendered = renderCodeql({})
    expect(rendered).toContain('push:')
  })

  it('pull_request trigger present', () => {
    const rendered = renderCodeql({})
    expect(rendered).toContain('pull_request:')
  })

  it('schedule trigger present', () => {
    const rendered = renderCodeql({})
    expect(rendered).toContain('schedule:')
  })
})
