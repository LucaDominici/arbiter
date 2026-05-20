// SPDX-License-Identifier: Apache-2.0
// Port #12 (#972): render invariants for PROVIDER_STATES.md.ejs.
//
// The template encodes the arbiter convention for Pact provider states:
// snake-case slug + descriptive prose, paired backend fixture file per slug,
// a slug→fixture mapping table, and a validation rule referenced by the
// scaffolded check-provider-states.mjs gate. The render output is the SSOT
// surface for that convention; missing any required section silently weakens
// contract-testing rigor downstream, so this suite asserts each required
// section is present and frontmatter is shaped per the locked doc schema.

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function makeData(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/provider-states-test', {
    language: 'typescript',
    projectName: 'my-service',
    governanceLevel: 'L2',
    contractType: 'rest-owned',
    hasPublicApi: true,
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
}

const TEMPLATE = 'contract-testing/PROVIDER_STATES.md.ejs'

describe('PROVIDER_STATES.md.ejs — render invariants (Port #12, #972)', () => {
  it('renders without EJS errors at L2 with contract-testing enabled', () => {
    expect(() => renderTemplate(TEMPLATE, makeData())).not.toThrow()
  })

  it('emits the locked frontmatter (status, tags, canonical_id)', () => {
    const out = renderTemplate(TEMPLATE, makeData())
    expect(out).toMatch(/^---\n/)
    expect(out).toContain("title: 'Provider States — Convention'")
    expect(out).toContain('status: active')
    expect(out).toContain("tags: ['audience/dev', 'kind/method']")
    expect(out).toContain("canonical_id: 'PROVIDER_STATES'")
    expect(out).toContain("doc_version: '1.0.0'")
  })

  it('explains WHAT a provider state is and cites the public Pact reference', () => {
    const out = renderTemplate(TEMPLATE, makeData())
    expect(out).toContain('## What is a provider state?')
    // Public reference must be cited (paraphrase-only policy; URL is fair-use citation).
    expect(out).toContain('docs.pact.io/getting_started/provider_states')
  })

  it('documents the snake-case slug + descriptive prose naming convention', () => {
    const out = renderTemplate(TEMPLATE, makeData())
    expect(out).toContain('## Naming convention')
    // The slug regex MUST appear in the doc — agents and humans both read this rule.
    expect(out).toContain('^[a-z][a-z0-9_]*$')
    // Worked example uses the canonical slug.
    expect(out).toContain('user_has_active_trip')
  })

  it('documents the per-stack fixture file layout under pact-samples/states/', () => {
    const out = renderTemplate(TEMPLATE, makeData())
    expect(out).toContain('## File layout')
    expect(out).toContain('contract-testing/pact-samples/states/')
    // All 5 supported stack extensions must be enumerated.
    expect(out).toMatch(/\{ts\|js\|py\|java\|kt\|rs\|go\}/)
  })

  it('includes the mapping-table header (Slug | Consumer | Provider | Fixture file)', () => {
    const out = renderTemplate(TEMPLATE, makeData())
    expect(out).toContain('## Mapping table')
    expect(out).toContain('| Slug')
    expect(out).toContain('| Consumer')
    expect(out).toContain('| Provider')
    expect(out).toContain('| Fixture file')
  })

  it('states the orphan-fixture validation rule and points to the gate script', () => {
    const out = renderTemplate(TEMPLATE, makeData())
    expect(out).toContain('## Validation rule')
    expect(out).toContain('MUST have a matching backend fixture file')
    expect(out).toContain('contract-testing/scripts/check-provider-states.mjs')
  })

  it('interpolates projectName and contractType into the header', () => {
    const out = renderTemplate(
      TEMPLATE,
      makeData({ projectName: 'svc-foo', contractType: 'graphql' }),
    )
    expect(out).toContain('svc-foo')
    expect(out).toContain('graphql')
  })

  it('chooses the .py fixture extension when language is python', () => {
    const out = renderTemplate(TEMPLATE, makeData({ language: 'python' }))
    expect(out).toContain('user_has_active_trip.fixture.py')
  })

  it('chooses the .rs fixture extension when language is rust', () => {
    const out = renderTemplate(TEMPLATE, makeData({ language: 'rust' }))
    expect(out).toContain('user_has_active_trip.fixture.rs')
  })

  it('produces an empty render at L1 (defensive guard inside template)', () => {
    const out = renderTemplate(TEMPLATE, makeData({ governanceLevel: 'L1' }))
    expect(out.trim()).toBe('')
  })

  it('produces an empty render when contractType is none', () => {
    const out = renderTemplate(TEMPLATE, makeData({ contractType: 'none' }))
    expect(out.trim()).toBe('')
  })
})
