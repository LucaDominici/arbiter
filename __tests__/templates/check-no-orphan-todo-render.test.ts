// SPDX-License-Identifier: Apache-2.0
// #2663 (INV-21): render test for the tree-scanning orphan-todo gate twin —
// the CI-runnable counterpart to the editor-time `.claude/hooks/check-no-orphan-todo.mjs`
// hook, which only ever inspects the single file in CLAUDE_TOOL_INPUT_PATH.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('check-no-orphan-todo.mjs.ejs rendering (#2663)', () => {
  it('renders a tree-scanning gate with the same regex/exit contract as the self script', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-no-orphan-todo.mjs.ejs', data)
    // Same reference regex as the self gate (scripts/check-no-orphan-todo.mjs):
    // an orphan-todo/FIXME-shaped comment must cite an issue like todo(#123).
    expect(content).toContain('ORPHAN_TODO')
    expect(content).toContain('#\\d+')
    // Tree-scanning, not single-file: walks via the shared glob-walk helper.
    expect(content).toContain('walkRepo')
    expect(content).toContain("from './lib/glob-walk.mjs'")
    // Exit contract: 1 on violations, 0 clean.
    expect(content).toContain('exitFn(1)')
    expect(content).toContain('exitFn(0)')
    expect(content).not.toContain('<%')
  })
})
