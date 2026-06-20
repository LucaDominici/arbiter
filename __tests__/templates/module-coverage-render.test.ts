// SPDX-License-Identifier: Apache-2.0
// #1457 (INV-134) — render coverage of scripts/verify-module-coverage.mjs.ejs (CANON-04).
// Behavioural tests for the pure ratchet live in
// __tests__/generators/module-coverage-ratchet.test.ts (they import the rendered module
// and exercise compareModuleCoverage); this file pins the render contract across
// archetypes so the template-test ratchet recognizes the template as covered.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const LANGUAGES = ['typescript', 'java', 'python', 'rust', 'go'] as const

describe('scripts/verify-module-coverage.mjs.ejs — rendering (#1457, CANON-04)', () => {
  for (const language of LANGUAGES) {
    it(`renders for language=${language} and interpolates the language switch`, () => {
      const rendered = renderTemplate('scripts/verify-module-coverage.mjs.ejs', {
        ...makeConfig('/tmp/proj', { language }),
        coverageThreshold: 80,
        coverageEnabled: true,
      } as unknown as Record<string, unknown>)
      expect(rendered).toContain(`const LANGUAGE = '${language}'`)
      // No unrendered EJS tags leaked.
      expect(rendered).not.toContain('<%')
    })
  }

  const rendered = renderTemplate('scripts/verify-module-coverage.mjs.ejs', {
    ...makeConfig('/tmp/proj', { language: 'typescript' }),
    coverageThreshold: 80,
    coverageEnabled: true,
  } as unknown as Record<string, unknown>)

  it('exports the pure compareModuleCoverage ratchet', () => {
    expect(rendered).toContain('export function compareModuleCoverage')
  })

  it('is greenfield-aware — excludes modules with zero executable lines', () => {
    expect(rendered).toContain('greenfield')
    expect(rendered).toContain('total <= 0')
  })

  it('supports --update-baseline and a first-run seed', () => {
    expect(rendered).toContain('--update-baseline')
    expect(rendered).toContain('module-coverage-baseline.json')
    expect(rendered).toContain('seeded module-coverage-baseline.json')
  })

  it('SKIPs (no false-fail) when no coverage summary is present', () => {
    expect(rendered).toContain('SKIP')
  })

  it('scaffolds per-language dispatch for Java/Python/Rust/Go', () => {
    expect(rendered).toContain('extractJavaCoverage')
    expect(rendered).toContain('extractPythonCoverage')
    expect(rendered).toContain('extractRustCoverage')
    expect(rendered).toContain('extractGoCoverage')
  })

  it('interpolates the project name in the header comment', () => {
    expect(rendered).toContain('test-project')
  })
})
