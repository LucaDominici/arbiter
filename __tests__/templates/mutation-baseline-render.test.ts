// SPDX-License-Identifier: Apache-2.0
// #1508 — render coverage of scripts/verify-mutation-baseline.mjs.ejs (CANON-04).
// Behavioural tests for the pure ratchet + Stryker score extractor live in
// __tests__/generators/mutation-baseline-ratchet.test.ts (they import the rendered
// module and exercise compareMutationScore / strykerScoreFromReport); this file pins
// the render contract across archetypes so the template-test ratchet recognizes the
// template as covered.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const LANGUAGES = ['typescript', 'java', 'python', 'rust', 'go'] as const

describe('scripts/verify-mutation-baseline.mjs.ejs — rendering (#1508, CANON-04)', () => {
  for (const language of LANGUAGES) {
    it(`renders for language=${language} and interpolates the language switch`, () => {
      const rendered = renderTemplate('scripts/verify-mutation-baseline.mjs.ejs', {
        ...makeConfig('/tmp/proj', { language }),
      } as unknown as Record<string, unknown>)
      expect(rendered).toContain(`const LANGUAGE = '${language}'`)
      // No unrendered EJS tags leaked.
      expect(rendered).not.toContain('<%')
    })
  }

  const rendered = renderTemplate('scripts/verify-mutation-baseline.mjs.ejs', {
    ...makeConfig('/tmp/proj', { language: 'typescript' }),
  } as unknown as Record<string, unknown>)

  it('exports the pure compareMutationScore ratchet + strykerScoreFromReport', () => {
    expect(rendered).toContain('export function compareMutationScore')
    expect(rendered).toContain('export function strykerScoreFromReport')
  })

  it('supports --update-baseline and a first-run seed of mutation-baseline.json', () => {
    expect(rendered).toContain('--update-baseline')
    expect(rendered).toContain('mutation-baseline.json')
    expect(rendered).toContain('seeded mutation-baseline.json')
  })

  it('SKIPs (no false-fail) when no mutation report is present', () => {
    expect(rendered).toContain('SKIP')
  })

  it('scaffolds per-stack dispatch for Stryker/pitest/cargo-mutants/mutmut', () => {
    expect(rendered).toContain('extractStrykerScore')
    expect(rendered).toContain('extractPitestScore')
    expect(rendered).toContain('extractCargoMutantsScore')
    expect(rendered).toContain('extractMutmutScore')
  })

  it('interpolates the project name in the header comment', () => {
    expect(rendered).toContain('test-project')
  })
})
