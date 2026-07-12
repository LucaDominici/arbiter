// SPDX-License-Identifier: Apache-2.0
// CANON-04: render test for src/templates/scripts/conformance.mjs.ejs (#1398, INV-128).
// This file satisfies the check-template-tests.mjs ratchet for scripts/conformance.mjs.ejs.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('scripts/conformance.mjs.ejs render (CANON-04, #1398)', () => {
  it('renders a self-contained advisory that no longer shells out to the retired command', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
    // The standalone `arbiter conformance` command was retired — the runner must NOT
    // spawn it (a generated project would call a dead command and fail).
    expect(content).not.toContain('spawnSync')
    expect(content).not.toMatch(/'conformance'\s*,/)
    // Intent preserved: it points at the surviving governance scorecard.
    expect(content).toContain('gold-audit')
  })

  it('rendered output starts with shebang', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('rendered output contains SPDX header', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })

  it('is fail-closed (INV-96): a top-level catch exits non-zero on unexpected error', () => {
    const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content).toMatch(/catch\s*\([^)]*\)\s*\{/)
    expect(content).toContain('process.exit(1)')
  })
})
