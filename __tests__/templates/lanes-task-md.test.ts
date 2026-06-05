import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1216: Lane discipline section was in task.md (orchestration prose). task.md is now
// the engine/CLI reference — no lane discipline section. Lane discipline in /ship is a
// follow-up (tech-debt). For now: verify task.md does NOT emit lane discipline content.

describe('task.md.ejs lane discipline (#1216)', () => {
  it('single-lane: no lane discipline section emitted', () => {
    const data = makeConfig('/tmp/test', { lanes: [] }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('claude/commands/task.md.ejs', data)
    expect(rendered).not.toContain('Lane Discipline')
    expect(rendered).not.toContain('Cross-stack')
  })

  it('multi-lane: task.md (engine-ref) does NOT emit lane discipline section', () => {
    // After #1216, task.md is engine-ref only — no orchestration prose including lane discipline.
    const data = makeConfig('/tmp/test', {
      lanes: ['frontend', 'backend'],
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('claude/commands/task.md.ejs', data)
    expect(rendered).not.toContain('Lane Discipline')
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
})
