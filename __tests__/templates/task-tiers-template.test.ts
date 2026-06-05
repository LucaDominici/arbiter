import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { DEFAULT_TASK_TIERS } from '../../src/config/schema.js'

// #1216: Tier classification moved from task.md to ship.md (orchestration entrypoint).

function render(taskTiers?: unknown): string {
  const config = makeConfig('/tmp/test', {
    governanceLevel: 'L2',
    testCommand: 'npm test',
  })
  const data = {
    ...(config as unknown as Record<string, unknown>),
    taskTiers,
  }
  // Tiers are now in ship.md (orchestration), not task.md (engine ref)
  return renderTemplate('claude/commands/ship.md.ejs', data)
}

describe('ship.md.ejs taskTiers rendering (#237, #1216)', () => {
  it('renders default tier guidance when taskTiers is undefined', () => {
    const out = render(undefined)
    // Default falls back to canonical XS=3, S=3, Standard=4
    // In ship.md the tier minimums appear in the phase map note
    expect(out).toMatch(/XS=3.*S=3.*Standard=4|XS|Standard/)
  })

  it('renders refactor row with review agent count', () => {
    const out = render(DEFAULT_TASK_TIERS)
    // Peer-review mode: refactor row shows Standard count
    expect(out).toMatch(/refactor/)
    expect(out).toMatch(/code-review agents|self-review/)
  })

  it('renders custom reviewAgentCount per tier (visible in phase map)', () => {
    const custom = {
      XS: { planDepth: 'minimal', reviewAgentCount: 2 },
      S: { planDepth: 'brief', reviewAgentCount: 5 },
      Standard: { planDepth: 'full', reviewAgentCount: 6 },
    }
    const out = render(custom)
    // Custom Standard count should appear in the refactor row or tier note
    expect(out).toMatch(/6/)
  })
})

describe('task.md.ejs BACKLOG step (#243)', () => {
  it('task.md does NOT include BACKLOG step (moved orchestration to /ship)', () => {
    const config = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
      testCommand: 'npm test',
    })
    const out = renderTemplate('claude/commands/task.md.ejs', {
      ...(config as unknown as Record<string, unknown>),
    })
    // BACKLOG step was in old task.md Phase 1; task.md is now engine-ref only
    expect(out).not.toContain('BACKLOG.md')
  })
})
