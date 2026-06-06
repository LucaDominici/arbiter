// SPDX-License-Identifier: Apache-2.0
// Render tests for wiki EJS templates (#1241): gen-wiki.mjs.ejs, check-wiki-lint.mjs.ejs, wiki-on-commit.mjs.ejs
// Verifies: no EJS leaks; renders across 5 stacks × 4 governance levels (CANON-13)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const
const LANGUAGES = ['typescript', 'java', 'python', 'go', 'rust'] as const

function cfg(level: string, language: string) {
  return makeConfig('/tmp/test', { governanceLevel: level, language }) as unknown as Record<
    string,
    unknown
  >
}

describe('gen-wiki.mjs.ejs — render across 5 stacks × 4 levels (#1241)', () => {
  for (const level of LEVELS) {
    for (const lang of LANGUAGES) {
      it(`renders without EJS leaks at ${level}/${lang}`, () => {
        const out = renderTemplate('scripts/gen-wiki.mjs.ejs', cfg(level, lang))
        expect(out).not.toContain('<%')
        expect(out).not.toContain('%>')
      })
    }
  }

  it('contains CATALOG block in output (INV-94)', () => {
    const out = renderTemplate('scripts/gen-wiki.mjs.ejs', cfg('L2', 'typescript'))
    expect(out).toContain('CATALOG:')
  })

  it('contains wiki/ output path reference', () => {
    const out = renderTemplate('scripts/gen-wiki.mjs.ejs', cfg('L2', 'typescript'))
    expect(out).toContain('wiki/')
  })

  it('contains query subcommand', () => {
    const out = renderTemplate('scripts/gen-wiki.mjs.ejs', cfg('L2', 'typescript'))
    expect(out).toContain('query')
  })
})

describe('check-wiki-lint.mjs.ejs — render across 5 stacks × 4 levels (#1241)', () => {
  for (const level of LEVELS) {
    for (const lang of LANGUAGES) {
      it(`renders without EJS leaks at ${level}/${lang}`, () => {
        const out = renderTemplate('scripts/check-wiki-lint.mjs.ejs', cfg(level, lang))
        expect(out).not.toContain('<%')
        expect(out).not.toContain('%>')
      })
    }
  }

  it('contains CATALOG block in output (INV-94)', () => {
    const out = renderTemplate('scripts/check-wiki-lint.mjs.ejs', cfg('L2', 'typescript'))
    expect(out).toContain('CATALOG:')
  })

  it('exits 0 on bootstrap mode (wiki/ not found)', () => {
    const out = renderTemplate('scripts/check-wiki-lint.mjs.ejs', cfg('L2', 'typescript'))
    expect(out).toContain('bootstrap mode')
  })
})

describe('wiki-on-commit.mjs.ejs — render across 5 stacks × 4 levels (#1241)', () => {
  for (const level of LEVELS) {
    for (const lang of LANGUAGES) {
      it(`renders without EJS leaks at ${level}/${lang}`, () => {
        const out = renderTemplate('claude/hooks/wiki-on-commit.mjs.ejs', cfg(level, lang))
        expect(out).not.toContain('<%')
        expect(out).not.toContain('%>')
      })
    }
  }

  it('references gen-wiki.mjs --changed for incremental update', () => {
    const out = renderTemplate('claude/hooks/wiki-on-commit.mjs.ejs', cfg('L2', 'typescript'))
    expect(out).toContain('gen-wiki.mjs')
    expect(out).toContain('--changed')
  })
})
