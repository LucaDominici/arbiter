// SPDX-License-Identifier: Apache-2.0
// CANON-04: render test for src/templates/scripts/check-anti-fake-green.mjs.ejs (#1428, INV-135).
// Satisfies the check-template-tests.mjs ratchet for scripts/check-anti-fake-green.mjs.ejs.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('scripts/check-anti-fake-green.mjs.ejs render (CANON-04, #1428)', () => {
  it('renders without error and delegates to `arbiter anti-fake-green`', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-anti-fake-green.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
    expect(content).toContain('arbiter')
    expect(content).toContain('anti-fake-green')
    expect(content).toContain('--no-install')
  })

  it('rendered output starts with shebang', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-anti-fake-green.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('rendered output contains SPDX header', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-anti-fake-green.mjs.ejs', config)
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })
})
