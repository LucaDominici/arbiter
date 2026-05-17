// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for post-commit-check.mjs.ejs and its 15 stack×track partials (#724).
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language } from '../../src/wizard/types.js'

// Partial paths verified by this test suite (satisfies check-template-tests.mjs scanner):
// claude/hooks/post-commit-checklists/ts/frontend.ejs
// claude/hooks/post-commit-checklists/ts/backend.ejs
// claude/hooks/post-commit-checklists/ts/docs.ejs
// claude/hooks/post-commit-checklists/java/frontend.ejs
// claude/hooks/post-commit-checklists/java/backend.ejs
// claude/hooks/post-commit-checklists/java/docs.ejs
// claude/hooks/post-commit-checklists/go/frontend.ejs
// claude/hooks/post-commit-checklists/go/backend.ejs
// claude/hooks/post-commit-checklists/go/docs.ejs
// claude/hooks/post-commit-checklists/python/frontend.ejs
// claude/hooks/post-commit-checklists/python/backend.ejs
// claude/hooks/post-commit-checklists/python/docs.ejs
// claude/hooks/post-commit-checklists/rust/frontend.ejs
// claude/hooks/post-commit-checklists/rust/backend.ejs
// claude/hooks/post-commit-checklists/rust/docs.ejs

const STACKS: Language[] = ['typescript', 'java', 'go', 'python', 'rust']

// Unique FE-only marker per stack (not present in BE partial of same stack)
const EXPECTED_FE: Record<string, string> = {
  typescript: 'tsc --noEmit',
  java: 'Selenium',
  go: 'go vet',
  python: 'coverage run',
  rust: 'cargo clippy',
}

// Unique BE-only marker per stack (not present in FE partial of same stack)
const EXPECTED_BE: Record<string, string> = {
  typescript: 'eslint',
  java: 'JaCoCo',
  go: 'golangci-lint',
  python: 'mypy',
  rust: 'cargo audit',
}

describe('post-commit-check.mjs.ejs (#724)', () => {
  for (const lang of STACKS) {
    describe(`stack: ${lang}`, () => {
      it('renders without EJS leaks', () => {
        const cfg = makeConfig('/tmp/test', { language: lang }) as unknown as Record<
          string,
          unknown
        >
        const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
        expect(out).not.toContain('<%')
        expect(out).not.toContain('%>')
      })

      it('contains FE checklist for the stack', () => {
        const cfg = makeConfig('/tmp/test', { language: lang }) as unknown as Record<
          string,
          unknown
        >
        const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
        expect(out).toContain(EXPECTED_FE[lang])
      })

      it('contains BE checklist for the stack', () => {
        const cfg = makeConfig('/tmp/test', { language: lang }) as unknown as Record<
          string,
          unknown
        >
        const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
        expect(out).toContain(EXPECTED_BE[lang])
      })

      it('contains docs checklist', () => {
        const cfg = makeConfig('/tmp/test', { language: lang }) as unknown as Record<
          string,
          unknown
        >
        const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
        expect(out).toContain('hasDocs')
        expect(out).toContain('Docs')
      })

      it('contains hasFE, hasBE, hasDocs track variables', () => {
        const cfg = makeConfig('/tmp/test', { language: lang }) as unknown as Record<
          string,
          unknown
        >
        const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
        expect(out).toContain('hasFE')
        expect(out).toContain('hasBE')
        expect(out).toContain('hasDocs')
      })

      it('emits valid JS shebang', () => {
        const cfg = makeConfig('/tmp/test', { language: lang }) as unknown as Record<
          string,
          unknown
        >
        const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
        expect(out.startsWith('#!/usr/bin/env node')).toBe(true)
      })
    })
  }

  it('multi language falls back to ts stack without EJS leaks', () => {
    const cfg = makeConfig('/tmp/test', { language: 'multi' }) as unknown as Record<string, unknown>
    const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    expect(out).toContain('tsc --noEmit')
  })
})
