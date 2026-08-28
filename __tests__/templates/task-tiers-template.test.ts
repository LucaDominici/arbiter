import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { DEFAULT_TASK_TIERS } from '../../src/config/schema.js'

// #1216: Tier classification moved from task.md to ship.md (orchestration entrypoint).

function render(taskTiers?: unknown, collaborationMode = 'peer-review'): string {
  const config = makeConfig('/tmp/test', {
    governanceLevel: 'L2',
    testCommand: 'npm test',
  })
  const data = {
    ...(config as unknown as Record<string, unknown>),
    taskTiers,
    collaborationMode,
  }
  // Tiers are now in ship.md (orchestration), not task.md (engine ref)
  return renderTemplate('claude/commands/ship.md.ejs', data)
}

function dispatchedReviewers(rendered: string): { count: number; names: string[] } {
  const namesMatch = rendered.match(/review_agents(?:_json)?='(\[[^']*\])'/)
  const countMatch = rendered.match(/printf '\{"count":(\d+),"agents":%s,"branch"/)

  if (namesMatch === null || countMatch === null) {
    throw new Error('Expected the non-solo review-dispatch sidecar block')
  }

  const names = JSON.parse(namesMatch[1]) as string[]
  const count = Number.parseInt(countMatch[1], 10)
  const sidecar = `{"count":${count},"agents":${namesMatch[1]},"branch":"b","sha":"s"}`

  expect(() => JSON.parse(sidecar)).not.toThrow()

  return { count, names }
}

describe('ship.md.ejs taskTiers rendering (#237, #1216)', () => {
  it('renders default tier guidance when taskTiers is undefined', () => {
    const out = render(undefined)
    // Default falls back to the canonical recalibrated minima in the non-solo phase map.
    expect(out.includes('Review-agent minimums by tier: XS=1, S=1, Standard=2.')).toBe(true)
    expect(out).toMatch(/\| `refactor` \|.*\| 2 \(Standard\) \|/)
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

  it('declares exactly one valid sidecar agent name per non-solo reviewer', () => {
    const custom = {
      XS: { planDepth: 'minimal', reviewAgentCount: 2 },
      S: { planDepth: 'brief', reviewAgentCount: 5 },
      Standard: { planDepth: 'full', reviewAgentCount: 6 },
    }

    for (const taskTiers of [DEFAULT_TASK_TIERS, custom]) {
      const { count, names } = dispatchedReviewers(render(taskTiers, 'peer-review'))

      expect(names).toHaveLength(count)
    }
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
