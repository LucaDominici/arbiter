// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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

describe('ship is one adaptive delivery narrative', () => {
  const levels: GovernanceLevel[] = ['L1', 'L2', 'L3']
  const languages: Language[] = ['typescript', 'java', 'rust', 'go', 'python']

  it.each(levels)('renders the same runtime-owned guarantees at %s', (governanceLevel) => {
    const content = render('claude/commands/ship.md.ejs', { governanceLevel })
    expect(content).toContain('single delivery entrypoint')
    expect(content).toContain('ShipTreatment')
    expect(content).toContain('.claude/.task/status.json')
    expect(content).not.toContain('.arbiter/evidence/redteam/')
    expect(content).toContain('.arbiter/agents-dispatched.json')
    expect(content).toContain('check-review-completion.mjs')
    expect(content).toContain('MED/HIGH/CRITICAL')
    expect(content).not.toContain('<%')
  })

  it.each(levels)('states the context economy rules at %s (#2761)', (governanceLevel) => {
    const content = render('claude/commands/ship.md.ejs', { governanceLevel })
    expect(content).toContain('## Context economy')
    expect(content).toContain('never pipe a gate or a test run through `tail` or `head`')
    expect(content).toContain('The first push runs one preflight plus touched tests')
    // Hooks do not run inside Agent-tool subagents, so delegation of the write lane is not prescribed.
    expect(content).not.toContain('implementer subagent')
    expect(content).not.toContain('npm run regen')
  })

  it.each(languages)('does not duplicate stack-specific gate policy for %s', (language) => {
    const content = render('claude/commands/ship.md.ejs', { language })
    expect(content).toContain('CI runs the full gate on that SHA')
  })

  it('keeps review and acceptance evidence separate and exact-subject bound', () => {
    const content = render('claude/commands/ship.md.ejs')
    expect(content).toContain('arbiter ship --review-round')
    expect(content).not.toContain('--mode reviewer-panel')
    expect(content).toContain('runtime review envelope and acceptance-fit evidence')
    expect(content).toContain('adversarial verifier and wave-worker path')
    expect(content).toContain('--mode ac-fit')
    expect(content).toContain('a different task/branch/SHA')
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

  it.each([
    'src/templates/claude/CLAUDE.md.ejs',
    'src/templates/claude/rules/90-exec-protocol.md.ejs',
    'src/templates/claude/skills/brainstorming/SKILL.md.ejs',
    'src/templates/claude/skills/wave-drain/SKILL.md.ejs',
    'src/templates/codex/CODEX.md.ejs',
  ])('%s does not advertise retired slash commands', (path) => {
    expect(readFileSync(path, 'utf8')).not.toMatch(
      /(?<![\w.-])\/(?:task|wt-open|wt-close|wt-list|wt-prune)\b/,
    )
  })
})
