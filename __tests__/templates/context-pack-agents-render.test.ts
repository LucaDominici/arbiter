import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language } from '../../src/wizard/types.js'

function cfg(language: Language = 'typescript') {
  return makeConfig('/tmp/test', { language }) as unknown as Record<string, unknown>
}

const ALL_LANGS: Language[] = ['typescript', 'java', 'rust', 'go', 'python']

describe('context-checker.md.ejs template rendering (#254)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('claude/agents/context-checker.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains frontmatter name field', () => {
    const out = renderTemplate('claude/agents/context-checker.md.ejs', cfg())
    expect(out).toContain('name: context-checker')
  })

  it('contains frontmatter description field', () => {
    const out = renderTemplate('claude/agents/context-checker.md.ejs', cfg())
    expect(out).toMatch(/^description: .+/m)
  })

  it('is read-only (no Edit/Write tools listed)', () => {
    const out = renderTemplate('claude/agents/context-checker.md.ejs', cfg())
    expect(out).not.toContain('- Edit')
    expect(out).not.toContain('- Write')
  })

  it('mentions CONTEXT_PACK', () => {
    const out = renderTemplate('claude/agents/context-checker.md.ejs', cfg())
    expect(out).toContain('CONTEXT_PACK')
  })

  it('renders for all 5 stacks without EJS leaks', () => {
    for (const lang of ALL_LANGS) {
      const out = renderTemplate('claude/agents/context-checker.md.ejs', cfg(lang))
      expect(out).not.toContain('<%')
    }
  })
})

describe('bridge-reviewer.md.ejs template rendering (#254)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('claude/agents/bridge-reviewer.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains frontmatter name field', () => {
    const out = renderTemplate('claude/agents/bridge-reviewer.md.ejs', cfg())
    expect(out).toContain('name: bridge-reviewer')
  })

  it('contains frontmatter description field', () => {
    const out = renderTemplate('claude/agents/bridge-reviewer.md.ejs', cfg())
    expect(out).toMatch(/^description: .+/m)
  })

  it('mentions PASS and REJECT verdicts', () => {
    const out = renderTemplate('claude/agents/bridge-reviewer.md.ejs', cfg())
    expect(out).toContain('PASS')
    expect(out).toContain('REJECT')
  })

  it('mentions combined verdict or matrix', () => {
    const out = renderTemplate('claude/agents/bridge-reviewer.md.ejs', cfg())
    // should mention either combined verdict or matrix
    const hasVerdict =
      out.toLowerCase().includes('combined') || out.toLowerCase().includes('matrix')
    expect(hasVerdict).toBe(true)
  })

  it('renders for all 5 stacks without EJS leaks', () => {
    for (const lang of ALL_LANGS) {
      const out = renderTemplate('claude/agents/bridge-reviewer.md.ejs', cfg(lang))
      expect(out).not.toContain('<%')
    }
  })
})
