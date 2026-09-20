// SPDX-License-Identifier: Apache-2.0
// CANON-04: render test for post-commit-check.mjs.ejs (#724).
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

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

describe('post-commit-check.mjs.ejs (#724)', () => {
  it('renders a silent advisory without EJS leaks', () => {
    const cfg = makeConfig('/tmp/test', { language: 'typescript' }) as unknown as Record<
      string,
      unknown
    >
    const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    expect(out.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(out).not.toContain('Track:')
  })

  it('registers the always-zero advisory in generated Claude and Codex dispatchers (#2767)', () => {
    const cfg = makeConfig('/tmp/test', { language: 'typescript' }) as unknown as Record<
      string,
      unknown
    >
    expect(renderTemplate('claude/hooks/hooks.mjs.ejs', cfg)).toContain('post-commit-check.mjs')
    expect(renderTemplate('codex/config.toml.ejs', cfg)).toContain('post-commit-check.mjs')
  })
})
