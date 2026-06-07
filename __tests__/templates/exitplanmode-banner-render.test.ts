// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { GovernanceLevel } from '../../src/wizard/types.js'

function configFor(level: GovernanceLevel = 'L2'): Record<string, unknown> {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: level,
  }) as unknown as Record<string, unknown>
}

describe('hooks/exitplanmode-banner.mjs.ejs — render (#1210)', () => {
  it('renders at L2 without EJS tag leaks', () => {
    const out = renderTemplate('claude/hooks/exitplanmode-banner.mjs.ejs', configFor('L2'))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('rendered output contains exitplanmode-banner identifier', () => {
    const out = renderTemplate('claude/hooks/exitplanmode-banner.mjs.ejs', configFor('L2'))
    expect(out).toContain('exitplanmode-banner')
  })
})
