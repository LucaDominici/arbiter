// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { GovernanceLevel } from '../../src/wizard/types.js'

function render(level: GovernanceLevel): string {
  const config = makeConfig('/tmp/test', { governanceLevel: level })
  return renderTemplate('claude/commands/ship.md.ejs', config as unknown as Record<string, unknown>)
}

function renderCommand(path: string): string {
  const config = makeConfig('/tmp/test', { governanceLevel: 'L2' })
  return renderTemplate(path, config as unknown as Record<string, unknown>)
}

describe('ship command renders the one runtime-owned delivery contract', () => {
  it.each(['L1', 'L2', 'L3'] as const)('keeps the same adaptive contract at %s', (level) => {
    const content = render(level)
    expect(content).toContain('single delivery entrypoint')
    expect(content).toContain('ShipTreatment')
    expect(content).toContain('Standard')
    expect(content).toContain(
      'run `arbiter ship --review-round`; it dispatches the reviewer in the foreground and records the envelope — do not dispatch reviewers or write envelopes by hand.',
    )
    expect(content).not.toContain('record-agent-return.mjs --mode ac-fit')
    expect(content).toContain('CI runs the full gate on that SHA')
    expect(content).not.toContain('red-team-review')
    expect(content).not.toContain('red-team-rework')
    expect(content).not.toContain('plan-review')
    expect(content).not.toContain('<%')
  })

  it('requires the plan facts consumed by narrow qualification', () => {
    const content = render('L2').toLowerCase()
    for (const marker of ['acceptance', 'non-goals', 'files:', 'proof', 'rollback']) {
      expect(content).toContain(marker)
    }
  })
})

describe('result-first host propagation', () => {
  it('records review and acceptance fit with one final-panel submission', () => {
    const content = renderCommand('claude/commands/review.md.ejs')
    expect(content).toContain('record-agent-return.mjs --mode reviewer-panel')
    expect(content).toContain('acceptance fit')
    expect(content).not.toContain('record-agent-return.mjs --mode ac-fit')
  })

  it('drain selects a bounded train and delegates delivery to the same Ship contract', () => {
    for (const path of ['claude/commands/drain.md.ejs', 'claude/skills/wave-drain/SKILL.md.ejs']) {
      const content = renderCommand(path)
      expect(content).toContain('arbiter ship')
      expect(content).not.toContain('plan-review')
      expect(content).not.toContain('red-team-review')
      expect(content).not.toMatch(/three red-team|3-hop plan gate/i)
    }
  })

  it('keeps checkpoint commits cheap and reserves full gates for delivery', () => {
    const content = renderCommand('claude/rules/90-exec-protocol.md.ejs')
    expect(content).toContain('staged')
    expect(content).toContain('final candidate')
    expect(content).not.toMatch(/L1` before (?:each )?commit/i)
  })
})
