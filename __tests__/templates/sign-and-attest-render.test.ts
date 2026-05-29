// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderAction(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/actions/sign-and-attest/action.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('sign-and-attest/action.yml.ejs — structural invariants (CANON-18)', () => {
  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('composite action uses: composite', () => {
    const rendered = renderAction({})
    expect(rendered).toContain('using: composite')
  })

  it('artifact-name input present', () => {
    const rendered = renderAction({})
    expect(rendered).toContain('artifact-name:')
  })

  it('artifact-path input present', () => {
    const rendered = renderAction({})
    expect(rendered).toContain('artifact-path:')
  })

  it('sigstore/cosign-installer step present', () => {
    const rendered = renderAction({})
    expect(rendered).toContain('sigstore/cosign-installer')
  })

  it('cosign sign-blob keyless step present', () => {
    const rendered = renderAction({})
    expect(rendered).toContain('cosign sign-blob --yes')
  })

  it('attest-build-provenance step present', () => {
    const rendered = renderAction({})
    expect(rendered).toContain('actions/attest-build-provenance')
  })

  it('signature bundle uploaded with 90-day retention', () => {
    const rendered = renderAction({})
    expect(rendered).toContain('-signatures')
    expect(rendered).toContain('retention-days: 90')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderAction({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Governance branching ─────────────────────────────────────────────────────

describe('sign-and-attest/action.yml.ejs — governance branching', () => {
  it('L4: verify step present after signing', () => {
    const rendered = renderAction({ governanceLevel: 'L4' })
    expect(rendered).toContain('cosign verify-blob')
    expect(rendered).toContain('token.actions.githubusercontent.com')
  })

  it('L3: verify step present (INV-101: all non-L1 verify signature)', () => {
    const rendered = renderAction({ governanceLevel: 'L3' })
    expect(rendered).toContain('cosign verify-blob')
    expect(rendered).toContain('token.actions.githubusercontent.com')
  })

  it('L2: verify step present (INV-101: all non-L1 verify signature)', () => {
    const rendered = renderAction({ governanceLevel: 'L2' })
    expect(rendered).toContain('cosign verify-blob')
    expect(rendered).toContain('token.actions.githubusercontent.com')
  })

  it('L1: no verify step (L1 stays lightweight, no sigstore.dev hard dependency)', () => {
    const rendered = renderAction({ governanceLevel: 'L1' })
    expect(rendered).not.toContain('cosign verify-blob')
  })
})
