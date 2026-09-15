// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { buildKnownLimitations } from '../../src/generators/codex-known-limitations.js'
import type { GovernanceLevel, Language } from '../../src/wizard/types.js'

function render(template: string, over: Record<string, unknown> = {}): string {
  return renderTemplate(template, {
    ...(makeConfig('/tmp/test') as unknown as Record<string, unknown>),
    ...over,
  })
}

describe('task remains the low-level lifecycle reference', () => {
  it('points to /ship and exposes recovery commands', () => {
    const content = render('claude/commands/task.md.ejs')
    expect(content).toContain('/ship')
    expect(content).toContain('arbiter task init')
    expect(content).toContain('arbiter task advance')
    expect(content).toContain('arbiter task record-tech-debt')
    expect(content).not.toContain('<%')
  })
})

describe('ship is one adaptive delivery narrative', () => {
  const levels: GovernanceLevel[] = ['L1', 'L2', 'L3']
  const languages: Language[] = ['typescript', 'java', 'rust', 'go', 'python']

  it.each(levels)('renders the same runtime-owned guarantees at %s', (governanceLevel) => {
    const content = render('claude/commands/ship.md.ejs', { governanceLevel })
    expect(content).toContain('single delivery entrypoint')
    expect(content).toContain('ShipTreatment')
    expect(content).toContain('.claude/.task/status.json')
    expect(content).toContain('.arbiter/evidence/redteam/')
    expect(content).toContain('.arbiter/agents-dispatched.json')
    expect(content).toContain('check-review-completion.mjs')
    expect(content).toContain('MED/HIGH/CRITICAL')
    expect(content).not.toContain('<%')
  })

  it.each(languages)('does not duplicate stack-specific gate policy for %s', (language) => {
    const content = render('claude/commands/ship.md.ejs', { language })
    expect(content).toContain('configured diagnostic')
    expect(content).toContain('one full clean-HEAD gate')
  })

  it('keeps review and acceptance evidence separate and exact-subject bound', () => {
    const content = render('claude/commands/ship.md.ejs')
    expect(content).toContain('--mode reviewer-panel')
    expect(content).toContain('--mode ac-fit')
    expect(content).toContain('exact-subject receipt')
    expect(content.replace(/\s+/g, ' ')).toMatch(/source change invalidates/i)
  })

  it('contains executable train affinity and resume paths', () => {
    const content = render('claude/commands/ship.md.ejs')
    expect(content).toContain('arbiter ship #NNN --advance')
    expect(content).toContain('arbiter ship #A #B #C --tier XS --affinity')
    expect(content).toContain('`--chain-add #B --chain-add #C`')
    expect(content).toContain('same treatment, phase, round, and next action')
  })
})

describe('host command inventories still expose /ship', () => {
  it('Claude inventory points to /ship', () => {
    expect(render('claude/CLAUDE.md.ejs')).toContain('/ship')
  })

  it('Codex inventory and protocol point to /ship', () => {
    const config = makeConfig('/tmp/test')
    const codex = renderTemplate('codex/CODEX.md.ejs', {
      ...config,
      knownLimitations: buildKnownLimitations(config),
    } as unknown as Record<string, unknown>)
    expect(codex).toContain('/ship')
    expect(render('claude/rules/90-exec-protocol.md.ejs')).toContain('/ship')
  })

  it.each(['claude/commands/wt-open.md.ejs', 'claude/commands/wt-close.md.ejs'])(
    '%s remains renderable',
    (command) => {
      expect(render(command)).not.toContain('<%')
    },
  )
})
