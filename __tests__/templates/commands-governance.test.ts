// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { GovernanceLevel } from '../../src/wizard/types.js'

function render(level: GovernanceLevel): string {
  const config = makeConfig('/tmp/test', { governanceLevel: level })
  return renderTemplate('claude/commands/ship.md.ejs', config as unknown as Record<string, unknown>)
}

describe('ship command renders the one runtime-owned delivery contract', () => {
  it.each(['L1', 'L2', 'L3'] as const)('keeps the same adaptive contract at %s', (level) => {
    const content = render(level)
    expect(content).toContain('single delivery entrypoint')
    expect(content).toContain('ShipTreatment')
    expect(content).toContain('Standard')
    expect(content).toContain('record-agent-return.mjs --mode reviewer-panel')
    expect(content).toContain('record-agent-return.mjs --mode ac-fit')
    expect(content).toContain('one clean-HEAD full gate')
    expect(content).not.toContain('<%')
  })

  it('requires the plan facts consumed by narrow qualification', () => {
    const content = render('L2').toLowerCase()
    for (const marker of ['acceptance', 'non-goals', 'files:', 'proof', 'rollback']) {
      expect(content).toContain(marker)
    }
  })
})
