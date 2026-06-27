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
  // Rust excluded: CodeQL has no native Rust support; generator skips 15-codeql for Rust projects.
  // `multi` (#1624) and `kotlin` are first-class detected stacks; both must scan the JVM side.
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'kotlin', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'multi', buildTool: 'maven' },
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

// ─── #1624: polyglot (multi) must scan EVERY language, not just the TS frontend ───────────────
//
// Before the fix `multi` fell through to the single 'javascript-typescript' default, emitting a
// green CodeQL check that performed ZERO SAST on the JVM backend. The matrix over the resolved
// language set is the regression lock: both legs must be present and each must compile its own
// language before analysis.

describe('15-codeql.yml.ejs — polyglot language coverage (#1624)', () => {
  it('multi scans BOTH java-kotlin and javascript-typescript (no single-language default)', () => {
    const rendered = renderCodeql({ language: 'multi', buildTool: 'maven' })
    expect(rendered).toContain('java-kotlin')
    expect(rendered).toContain('javascript-typescript')
    // The matrix carries the full set, not a hardcoded single language.
    expect(rendered).toContain('["java-kotlin","javascript-typescript"]')
  })

  it('multi drives a matrix leg per language (init + category consume matrix.language)', () => {
    const rendered = renderCodeql({ language: 'multi', buildTool: 'maven' })
    expect(rendered).toMatch(/matrix:\s*\n\s*language:/)
    expect(rendered).toContain('languages: ${{ matrix.language }}')
    expect(rendered).toContain("category: '/language:${{ matrix.language }}'")
  })

  it('multi compiles the JVM backend leg in backend/ so the compiled-language SAST is real', () => {
    const rendered = renderCodeql({ language: 'multi', buildTool: 'maven' })
    expect(rendered).toContain('working-directory: backend')
    expect(rendered).toMatch(/if: matrix\.language == 'java-kotlin'/)
    expect(rendered).toContain('mvn compile test-compile -DskipTests')
  })

  it('multi-gradle backend builds with gradle in backend/', () => {
    const rendered = renderCodeql({ language: 'multi', buildTool: 'gradle' })
    expect(rendered).toContain('working-directory: backend')
    expect(rendered).toContain('./gradlew classes testClasses')
  })

  it('kotlin maps to the java-kotlin CodeQL pack (not the TS default)', () => {
    const rendered = renderCodeql({ language: 'kotlin', buildTool: 'gradle' })
    expect(rendered).toContain('java-kotlin')
    expect(rendered).not.toContain('javascript-typescript')
  })

  it('single-language typescript stays a one-leg matrix (no java/go build steps)', () => {
    const rendered = renderCodeql({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('["javascript-typescript"]')
    expect(rendered).not.toContain('java-kotlin')
    expect(rendered).not.toContain('setup-java')
    expect(rendered).not.toContain('working-directory: backend')
  })
})
