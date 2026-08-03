// SPDX-License-Identifier: Apache-2.0
// Render tests for target documentation generators (#2214, CANON-04).
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const
const LANGUAGES = ['typescript', 'java', 'python', 'go', 'rust'] as const

function cfg(level: string, language: string): Record<string, unknown> {
  return makeConfig('/tmp/test', { governanceLevel: level, language }) as unknown as Record<
    string,
    unknown
  >
}

describe('documentation generator templates — render across 5 stacks × 4 levels (#2214)', () => {
  for (const template of [
    'scripts/gen-doc-index.mjs.ejs',
    'scripts/gen-llms-txt.mjs.ejs',
    'llms-txt.config.json.ejs',
  ]) {
    for (const level of LEVELS) {
      for (const language of LANGUAGES) {
        it(`${template} renders without EJS leaks at ${level}/${language}`, () => {
          const out = renderTemplate(template, cfg(level, language))
          expect(out).not.toContain('<%')
          expect(out).not.toContain('%>')
        })
      }
    }
  }

  // gen-llms-txt's findMissingPaths() fails CLOSED (exit 2) on any config path that does not
  // resolve, so the seed may only name files `arbiter init` actually produces. README.md is NOT
  // one of them — a virgin target has no README, and seeding it made the emitted generator exit 2
  // on its very first run. Verified empirically against a real `arbiter init -y --level L2` tree.
  it('seeds the llms config only with paths a virgin target actually has', () => {
    const out = renderTemplate('llms-txt.config.json.ejs', cfg('L2', 'typescript'))
    expect(out).toContain('AGENTS.md')
    expect(out).toContain('docs/INDEX.md')
    expect(out).not.toContain('README.md')
  })

  it('parses as JSON after rendering (it is a real config file, not prose)', () => {
    const out = renderTemplate('llms-txt.config.json.ejs', cfg('L2', 'typescript'))
    expect(() => JSON.parse(out)).not.toThrow()
  })
})
