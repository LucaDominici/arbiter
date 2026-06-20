// SPDX-License-Identifier: Apache-2.0
// CANON-04: render test for src/templates/scripts/check-doc-set.mjs.ejs (#1428, INV-135).
// This file satisfies the check-template-tests.mjs ratchet for scripts/check-doc-set.mjs.ejs.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('scripts/check-doc-set.mjs.ejs render (CANON-04, #1428)', () => {
  it('renders without error and delegates to `arbiter doc-set`', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-set.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
    expect(content).toContain('arbiter')
    expect(content).toContain('doc-set')
    expect(content).toContain('--no-install')
  })

  it('rendered output starts with shebang', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-set.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('rendered output contains SPDX header', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/check-doc-set.mjs.ejs', config)
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })
})
