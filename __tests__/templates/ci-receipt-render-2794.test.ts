// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #2794: the two templates introduced with CI-owned verification render and keep their contract.
describe('CI-owned verification templates (#2794)', () => {
  const cfg = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L2' })

  it('scripts/ci-receipt.mjs.ejs records a CI verdict for HEAD and fails closed on NO DATA', () => {
    const out = renderTemplate('scripts/ci-receipt.mjs.ejs', cfg)
    expect(out).toContain('ci-pass.json')
    expect(out).toMatch(/gh/)
    expect(out).toMatch(/NO DATA/)
  })

  it('claude/hooks/enforce-gate-before-pr.mjs.ejs accepts a ci-pass receipt for HEAD', () => {
    const out = renderTemplate('claude/hooks/enforce-gate-before-pr.mjs.ejs', cfg)
    expect(out).toContain('ci-pass.json')
    expect(out).toContain('gate-pass.json')
  })
})
