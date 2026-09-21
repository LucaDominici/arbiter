// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(taskTiers?: unknown): string {
  return renderTemplate('claude/commands/ship.md.ejs', {
    ...(makeConfig('/tmp/test', { governanceLevel: 'L2' }) as unknown as Record<string, unknown>),
    taskTiers,
  })
}

describe('ship treatment template', () => {
  it('renders the runtime-owned tier obligations', () => {
    const output = render().replace(/\s+/g, ' ')
    expect(output).toMatch(/\| XS\s+\| minimal \|\s+0 \|\s+1 pertinent vertical/)
    expect(output).toMatch(/\| Standard\s+\| full\s+\|\s+0 \|\s+1 pertinent vertical/)
    expect(output).toMatch(/\| Sensitive \| full\s+\|\s+0 \| relevant specialists, maximum 3/)
  })

  it('does not let a stale template input redefine runtime reviewer counts', () => {
    const custom = {
      XS: { planDepth: 'minimal', reviewAgentCount: 7 },
      Standard: { planDepth: 'full', reviewAgentCount: 9 },
    }
    expect(render(custom)).toBe(render())
  })

  it('uses runtime-owned foreground reviewer certification', () => {
    expect(render().replace(/\s+/g, ' ')).toContain(
      'run `arbiter ship --review-round`; it dispatches the reviewer in the foreground and records the envelope — do not dispatch reviewers or write envelopes by hand.',
    )
  })
})
