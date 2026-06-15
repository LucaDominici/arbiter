// SPDX-License-Identifier: Apache-2.0
// CANON-04 render tests for the #1366 render-smoke templates (INV-127).
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// makeConfig needs a dir; templates here don't touch the FS, so a placeholder is fine.
const cfg = (over: Record<string, unknown> = {}) =>
  makeConfig('/tmp/render-smoke-render-test', {
    archetype: 'frontend-spa',
    language: 'typescript',
    ...over,
  })

describe('render-smoke.spec.ts.ejs (#1366, INV-127)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('e2e/playwright-ts/render-smoke.spec.ts.ejs', cfg())
    expect(out).not.toMatch(/<%/)
    expect(out).not.toMatch(/%>/)
  })

  it('boots the SPA and asserts zero console errors', () => {
    const out = renderTemplate('e2e/playwright-ts/render-smoke.spec.ts.ejs', cfg())
    expect(out).toMatch(/E2E_BASE_URL/)
    expect(out).toMatch(/pageerror/)
    expect(out).toMatch(/consoleErrors/)
    expect(out).toMatch(/INV-127/)
  })

  it('is framework-aware: react → #root, vue → #app, angular → app-root', () => {
    const react = renderTemplate('e2e/playwright-ts/render-smoke.spec.ts.ejs', cfg())
    expect(react).toMatch(/MOUNT_SELECTOR = '#root'/)
    const vue = renderTemplate(
      'e2e/playwright-ts/render-smoke.spec.ts.ejs',
      cfg({ frontend: { framework: 'vue' } }),
    )
    expect(vue).toMatch(/MOUNT_SELECTOR = '#app'/)
    const ng = renderTemplate(
      'e2e/playwright-ts/render-smoke.spec.ts.ejs',
      cfg({ frontend: { framework: 'angular' } }),
    )
    expect(ng).toMatch(/MOUNT_SELECTOR = 'app-root'/)
  })
})

describe('check-render-smoke.mjs.ejs (#1366, INV-127)', () => {
  it('renders without EJS leaks and carries the CATALOG block', () => {
    const out = renderTemplate('scripts/check-render-smoke.mjs.ejs', cfg())
    expect(out).not.toMatch(/<%/)
    expect(out).toMatch(/CATALOG: INV-127/)
    expect(out).toMatch(/glob-walk\.mjs/)
  })
})

describe('glob-walk.mjs.ejs (#1366)', () => {
  it('renders without EJS leaks and exports the shared helpers', () => {
    const out = renderTemplate('scripts/lib/glob-walk.mjs.ejs', cfg())
    expect(out).not.toMatch(/<%/)
    expect(out).toMatch(/export function globMatch/)
    expect(out).toMatch(/export function walkRepo/)
  })
})

describe('check-all.mjs.ejs wires the render-smoke gate (#1366)', () => {
  it('contains the render-smoke presence runCheck (unconditional L1 gate)', () => {
    // The runCheck is unconditional, so a minimal TS/L1 config (matching the
    // working pattern in check-all-render.test.ts) is sufficient to render it.
    const data = makeConfig('/tmp/render-smoke-check-all', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const out = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(out).toMatch(/check-render-smoke\.mjs/)
    expect(out).toMatch(/INV-127/)
  })
})
