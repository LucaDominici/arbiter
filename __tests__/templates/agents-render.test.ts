import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language } from '../../src/wizard/types.js'

function cfg(language: Language = 'typescript') {
  return makeConfig('/tmp/test', { language }) as unknown as Record<string, unknown>
}

describe('claude agent skill template rendering (#166)', () => {
  describe('codebase-scanner.md.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('claude/agents/codebase-scanner.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('contains frontmatter name field', () => {
      const out = renderTemplate('claude/agents/codebase-scanner.md.ejs', cfg())
      expect(out).toContain('name:')
    })

    it('contains frontmatter description field', () => {
      const out = renderTemplate('claude/agents/codebase-scanner.md.ejs', cfg())
      expect(out).toContain('description:')
    })

    it('renders correctly for all 5 stacks', () => {
      for (const lang of ['typescript', 'java', 'rust', 'go', 'python'] as Language[]) {
        const out = renderTemplate('claude/agents/codebase-scanner.md.ejs', cfg(lang))
        expect(out).not.toContain('<%')
      }
    })
  })

  describe('red-team.md.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('claude/agents/red-team.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('contains frontmatter name field', () => {
      const out = renderTemplate('claude/agents/red-team.md.ejs', cfg())
      expect(out).toContain('name:')
    })

    it('contains frontmatter description field', () => {
      const out = renderTemplate('claude/agents/red-team.md.ejs', cfg())
      expect(out).toContain('description:')
    })

    it('renders correctly for all 5 stacks', () => {
      for (const lang of ['typescript', 'java', 'rust', 'go', 'python'] as Language[]) {
        const out = renderTemplate('claude/agents/red-team.md.ejs', cfg(lang))
        expect(out).not.toContain('<%')
      }
    })
  })
})
