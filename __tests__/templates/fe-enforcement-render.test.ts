// SPDX-License-Identifier: Apache-2.0
// CANON-04 render tests for Slices 4/5/6 templates (#1127)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderCfg(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/test', {
    archetype: 'frontend-spa',
    projectName: 'test-project',
    governanceLevel: 'L2',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
}

function r(template: string, overrides: Record<string, unknown> = {}) {
  return renderTemplate(template, renderCfg(overrides))
}

// ── Slice 4: FE coverage ratchet ─────────────────────────────────────────────
describe('scripts/verify-fe-coverage.mjs.ejs (CANON-04, #1127)', () => {
  it('no EJS tag leaks', () => {
    expect(r('scripts/verify-fe-coverage.mjs.ejs')).not.toContain('<%')
  })

  it('exits with code 1 on regression', () => {
    expect(r('scripts/verify-fe-coverage.mjs.ejs')).toContain('process.exit(1)')
  })

  it('references FSD layers', () => {
    const out = r('scripts/verify-fe-coverage.mjs.ejs')
    expect(out).toContain('features')
    expect(out).toContain('entities')
  })

  it('upward-only ratchet mentioned', () => {
    expect(r('scripts/verify-fe-coverage.mjs.ejs')).toMatch(/upward-only|ratchet/i)
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)('governance %s: no EJS tag leaks', (l) => {
    expect(r('scripts/verify-fe-coverage.mjs.ejs', { governanceLevel: l })).not.toContain('<%')
  })
})

// ── Slice 5: Vitest browser mode config ──────────────────────────────────────
describe('coverage/vitest.browser.config.ts.ejs (CANON-04, #1127)', () => {
  it('no EJS tag leaks for react', () => {
    expect(
      r('coverage/vitest.browser.config.ts.ejs', { frontend: { framework: 'react' } }),
    ).not.toContain('<%')
  })

  it('no EJS tag leaks for vue', () => {
    expect(
      r('coverage/vitest.browser.config.ts.ejs', { frontend: { framework: 'vue' } }),
    ).not.toContain('<%')
  })

  it('no EJS tag leaks for svelte', () => {
    expect(
      r('coverage/vitest.browser.config.ts.ejs', { frontend: { framework: 'svelte' } }),
    ).not.toContain('<%')
  })

  it('vue: uses @vitejs/plugin-vue', () => {
    expect(
      r('coverage/vitest.browser.config.ts.ejs', { frontend: { framework: 'vue' } }),
    ).toContain('@vitejs/plugin-vue')
  })

  it('react: uses @vitejs/plugin-react', () => {
    expect(
      r('coverage/vitest.browser.config.ts.ejs', { frontend: { framework: 'react' } }),
    ).toContain('@vitejs/plugin-react')
  })

  it('uses Playwright as browser provider', () => {
    expect(r('coverage/vitest.browser.config.ts.ejs')).toContain('playwright')
  })

  it('uses chromium browser', () => {
    expect(r('coverage/vitest.browser.config.ts.ejs')).toContain('chromium')
  })

  it('headless: true', () => {
    expect(r('coverage/vitest.browser.config.ts.ejs')).toContain('headless: true')
  })
})

describe('frontend/vrt-setup.md.ejs (CANON-04, #1127)', () => {
  it('no EJS tag leaks', () => {
    expect(r('frontend/vrt-setup.md.ejs')).not.toContain('<%')
  })

  it('mentions baseline capture instructions', () => {
    expect(r('frontend/vrt-setup.md.ejs')).toMatch(/update.snapshot|baseline/i)
  })

  it('mentions toMatchScreenshot', () => {
    expect(r('frontend/vrt-setup.md.ejs')).toContain('toMatchScreenshot')
  })
})

// ── Slice 6: Lighthouse + bundle-size budgets ─────────────────────────────────
describe('perf/lighthouserc.json.ejs (CANON-04, #1127)', () => {
  it('no EJS tag leaks', () => {
    expect(r('perf/lighthouserc.json.ejs')).not.toContain('<%')
  })

  it('produces valid JSON', () => {
    expect(() => JSON.parse(r('perf/lighthouserc.json.ejs'))).not.toThrow()
  })

  it('LCP budget ≤2500ms (2.5s)', () => {
    const json = JSON.parse(r('perf/lighthouserc.json.ejs'))
    expect(json.ci.assert.assertions['largest-contentful-paint'][1].maxNumericValue).toBe(2500)
  })

  it('CLS budget ≤0.1', () => {
    const json = JSON.parse(r('perf/lighthouserc.json.ejs'))
    expect(json.ci.assert.assertions['cumulative-layout-shift'][1].maxNumericValue).toBe(0.1)
  })

  it('INP budget ≤200ms', () => {
    const json = JSON.parse(r('perf/lighthouserc.json.ejs'))
    expect(json.ci.assert.assertions['interactive'][1].maxNumericValue).toBe(200)
  })

  it('assertions are error-level (blocking)', () => {
    const json = JSON.parse(r('perf/lighthouserc.json.ejs'))
    expect(json.ci.assert.assertions['largest-contentful-paint'][0]).toBe('error')
    expect(json.ci.assert.assertions['cumulative-layout-shift'][0]).toBe('error')
  })
})

describe('perf/bundle-budget.json.ejs (CANON-04, #1127)', () => {
  it('no EJS tag leaks', () => {
    expect(r('perf/bundle-budget.json.ejs')).not.toContain('<%')
  })

  it('produces valid JSON', () => {
    expect(() => JSON.parse(r('perf/bundle-budget.json.ejs'))).not.toThrow()
  })

  it('has budgets array with maxSize entries', () => {
    const json = JSON.parse(r('perf/bundle-budget.json.ejs'))
    expect(json.budgets).toBeDefined()
    expect(json.budgets.length).toBeGreaterThan(0)
    expect(json.budgets[0].maxSize).toBeTruthy()
  })
})

describe('scripts/check-bundle-size.mjs.ejs (CANON-04, #1127)', () => {
  it('no EJS tag leaks', () => {
    expect(r('scripts/check-bundle-size.mjs.ejs')).not.toContain('<%')
  })

  it('exits with code 1 on budget violation', () => {
    expect(r('scripts/check-bundle-size.mjs.ejs')).toContain('process.exit(1)')
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)('governance %s: no EJS tag leaks', (l) => {
    expect(r('scripts/check-bundle-size.mjs.ejs', { governanceLevel: l })).not.toContain('<%')
  })
})
