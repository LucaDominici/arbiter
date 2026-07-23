// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1131 slice 2: the setup-node-pnpm composite is extended to bundle
// setup-node + `npm ci` (opt-out via the `install` input) and to pin a single
// canonical setup-node SHA. sync-action-pins (INV-76) does NOT scan composite
// action.yml, so this render test is the pin guard.

// Canonical setup-node pin the composite consolidates to (v7.0.0).
const CANONICAL_SETUP_NODE = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020'

function renderAction(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/actions/setup-node-pnpm/action.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('setup-node-pnpm/action.yml.ejs — structural invariants (CANON-18, #1131)', () => {
  it('is a composite action', () => {
    expect(renderAction()).toContain('using: composite')
  })

  it('pins the single canonical setup-node SHA (v7.0.0) — INV-76 guard', () => {
    expect(renderAction()).toContain(CANONICAL_SETUP_NODE)
  })

  it('exposes an `install` input (opt-out for bare setup-node jobs)', () => {
    const rendered = renderAction()
    expect(rendered).toMatch(/^\s{2}install:/m)
  })

  it('runs `npm ci` gated on the install input, via bash', () => {
    const rendered = renderAction()
    expect(rendered).toContain('npm ci')
    expect(rendered).toContain("inputs.install == 'true'")
    expect(rendered).toContain('shell: bash')
  })

  it('still sets up node from .nvmrc with npm cache', () => {
    const rendered = renderAction()
    expect(rendered).toContain('node-version-file')
    expect(rendered).toContain('cache: npm')
  })
})
