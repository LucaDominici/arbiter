import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('task.md.ejs lane discipline', () => {
  it('single-lane: no lane discipline section emitted', () => {
    const data = makeConfig('/tmp/test', { lanes: [] }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('claude/commands/task.md.ejs', data)
    expect(rendered).not.toContain('Lane Discipline')
    expect(rendered).not.toContain('Cross-stack')
  })

  it('multi-lane: lane discipline section present', () => {
    const data = makeConfig('/tmp/test', {
      lanes: ['frontend', 'backend'],
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('claude/commands/task.md.ejs', data)
    expect(rendered).toContain('Lane Discipline')
    expect(rendered).toContain('Cross-stack')
  })

  it('multi-lane: shows detected lanes in table', () => {
    const data = makeConfig('/tmp/test', {
      lanes: ['frontend', 'backend', 'docs'],
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('claude/commands/task.md.ejs', data)
    expect(rendered).toContain('frontend')
    expect(rendered).toContain('backend')
    expect(rendered).toContain('docs')
  })

  it('single-lane: output identical for lanes:[] across L1/L2/L3', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const base = makeConfig('/tmp/test', {
        governanceLevel: level,
        lanes: [],
      }) as unknown as Record<string, unknown>
      const withEmptyLanes = makeConfig('/tmp/test', {
        governanceLevel: level,
      }) as unknown as Record<string, unknown>
      // Both default to [] so output should match
      expect(renderTemplate('claude/commands/task.md.ejs', base)).toBe(
        renderTemplate('claude/commands/task.md.ejs', withEmptyLanes),
      )
    }
  })

  it('multi-lane: cross-stack STOP rule present', () => {
    const data = makeConfig('/tmp/test', {
      lanes: ['frontend', 'backend'],
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('claude/commands/task.md.ejs', data)
    expect(rendered).toContain('STOP')
    expect(rendered).toMatch(/touch.*both|both.*lanes?|split/i)
  })
})
