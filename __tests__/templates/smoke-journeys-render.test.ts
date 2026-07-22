// SPDX-License-Identifier: Apache-2.0
// INV-48 (CANON-04) render coverage for the smoke-journey templates (#2080, INV-137).
// Lives under __tests__/templates/ so the check-template-tests.mjs ratchet counts each
// smoke-journey .ejs as tested. Every template must render without throwing.
import { describe, it, expect } from 'vitest'
import { makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'

describe('smoke-journey templates render (INV-48, CANON-04)', () => {
  it('scripts/check-smoke-journeys.mjs.ejs renders a runnable gate', () => {
    const rendered = renderTemplate('scripts/check-smoke-journeys.mjs.ejs', {
      ...makeConfig('/tmp/render-smoke-journeys', { language: 'typescript' }),
    } as unknown as Record<string, unknown>)
    expect(rendered.length).toBeGreaterThan(200)
    expect(rendered).toMatch(/smoke-journeys\.json/)
  })

  it('smoke-journeys/manifest.json.ejs renders the manifest JSON verbatim (diff-mock parity, #1331)', () => {
    const manifestJson = JSON.stringify(
      { archetype: 'frontend-spa', applicable: true, journeys: [] },
      null,
      2,
    )
    const rendered = renderTemplate('smoke-journeys/manifest.json.ejs', { manifestJson })
    const parsed = JSON.parse(rendered)
    expect(parsed.archetype).toBe('frontend-spa')
    expect(parsed.applicable).toBe(true)
  })

  it('e2e/smoke-journeys/journeys.spec.ts.ejs scaffolds a non-trivial starter with auth+crud blocks', () => {
    const rendered = renderTemplate('e2e/smoke-journeys/journeys.spec.ts.ejs', {
      ...makeConfig('/tmp/render-smoke-journeys-spec', {
        language: 'typescript',
        archetype: 'frontend-spa',
      }),
    } as unknown as Record<string, unknown>)
    expect(rendered.length).toBeGreaterThan(120)
    // Honest starter: real per-journey test blocks (not an empty pass-through).
    expect(rendered).toMatch(/auth/i)
    expect(rendered).toMatch(/crud/i)
    expect(rendered).toMatch(/\btest\(|\bit\(/)
  })
})
