// SPDX-License-Identifier: Apache-2.0
// #1319.8 — render coverage of scripts/lib/coverage-gate.mjs.ejs (INV-48, CANON-04).
// The behavioural predicate tests live in
// __tests__/generators/coverage-greenfield-guard.test.ts (they import the rendered
// module and exercise evaluateCoverageGate); this file pins the render contract so
// the template-test ratchet recognizes the template as covered.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('scripts/lib/coverage-gate.mjs.ejs — rendering (#1319.8, CANON-04)', () => {
  const rendered = renderTemplate('scripts/lib/coverage-gate.mjs.ejs', {
    ...makeConfig('/tmp/proj', { language: 'typescript' }),
    coverageThreshold: 80,
    coverageEnabled: true,
  } as unknown as Record<string, unknown>)

  it('exports evaluateCoverageGate', () => {
    expect(rendered).toContain('export function evaluateCoverageGate')
  })

  it('PASSES greenfield when total.statements.total === 0', () => {
    expect(rendered).toContain('statements.total === 0')
    expect(rendered).toContain('no executable statements (greenfield)')
  })

  it('FAILS closed when the summary is null/malformed (no skip)', () => {
    expect(rendered).toContain("status: 'FAIL'")
    expect(rendered).toContain('no coverage summary')
  })

  it('enforces the line threshold when executable statements exist', () => {
    expect(rendered).toContain('threshold')
    expect(rendered).toMatch(/pct[^<]*<[^t]*threshold/)
  })

  it('interpolates the project name in the header comment', () => {
    expect(rendered).toContain('test-project')
  })
})
