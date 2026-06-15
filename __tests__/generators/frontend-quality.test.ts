// SPDX-License-Identifier: Apache-2.0
// CANON-05 generator unit tests for frontend-quality.ts (#1127)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateFrontendQuality } from '../../src/generators/frontend-quality.js'

describe('generateFrontendQuality (#1127)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // ── Gate guard ─────────────────────────────────────────────────────────────

  it('returns empty files for non-frontend archetype with no frontend lane', () => {
    const result = generateFrontendQuality(
      makeConfig(dir, { archetype: 'backend-web-db', lanes: ['backend'] }),
    )
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files for backend-only library archetype', () => {
    const result = generateFrontendQuality(makeConfig(dir, { archetype: 'library' }))
    expect(result.files).toHaveLength(0)
  })

  it('emits files for frontend-spa archetype', () => {
    const result = generateFrontendQuality(
      makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }),
    )
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('emits files when lanes includes frontend (non-spa archetype)', () => {
    const result = generateFrontendQuality(
      makeConfig(dir, {
        archetype: 'backend-web-db',
        lanes: ['frontend', 'backend'],
        governanceLevel: 'L2',
      }),
    )
    expect(result.files.length).toBeGreaterThan(0)
  })

  // ── Token artifacts ────────────────────────────────────────────────────────

  it('emits design-tokens.json (W3C DTCG format)', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'design-tokens.json'))).toBe(true)
    const tokens = JSON.parse(readFileSync(join(dir, 'design-tokens.json'), 'utf-8'))
    // W3C DTCG: top-level key must have nested entries with $value/$type
    const keys = Object.keys(tokens)
    expect(keys.length).toBeGreaterThan(0)
  })

  it('emits scripts/verify-tokens.mjs', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'verify-tokens.mjs'))).toBe(true)
  })

  it('verify-tokens.mjs contains INV-105 reference', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'verify-tokens.mjs'), 'utf-8')
    expect(content).toContain('INV-105')
  })

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('is idempotent — second run returns action skipped', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' })
    const result1 = generateFrontendQuality(config)
    expect(result1.files.every((f) => f.action === 'created')).toBe(true)

    const result2 = generateFrontendQuality(config)
    expect(result2.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  // ── dryRun ─────────────────────────────────────────────────────────────────

  it('dryRun: true returns created action without writing files', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' })
    const result = generateFrontendQuality(config, { dryRun: true })
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
    expect(existsSync(join(dir, 'design-tokens.json'))).toBe(false)
    expect(existsSync(join(dir, 'scripts', 'verify-tokens.mjs'))).toBe(false)
  })

  // ── Framework-aware token output ───────────────────────────────────────────

  it('vue framework: verify-tokens.mjs includes .vue extension', () => {
    generateFrontendQuality(
      makeConfig(dir, {
        archetype: 'frontend-spa',
        governanceLevel: 'L2',
        frontend: { framework: 'vue' },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'verify-tokens.mjs'), 'utf-8')
    expect(content).toContain('.vue')
  })

  it('react framework: verify-tokens.mjs includes .tsx extension', () => {
    generateFrontendQuality(
      makeConfig(dir, {
        archetype: 'frontend-spa',
        governanceLevel: 'L2',
        frontend: { framework: 'react' },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'verify-tokens.mjs'), 'utf-8')
    expect(content).toContain('.tsx')
  })

  // ── S4/5/6 artifacts ───────────────────────────────────────────────────────

  it('emits scripts/verify-fe-coverage.mjs', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'verify-fe-coverage.mjs'))).toBe(true)
  })

  it('emits vitest.browser.config.ts', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'vitest.browser.config.ts'))).toBe(true)
  })

  it('emits .lighthouserc.json with Core Web Vitals 2026 budgets', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.lighthouserc.json'))).toBe(true)
    const rc = JSON.parse(readFileSync(join(dir, '.lighthouserc.json'), 'utf-8'))
    expect(rc.ci.assert.assertions['largest-contentful-paint'][1].maxNumericValue).toBe(2500)
    expect(rc.ci.assert.assertions['cumulative-layout-shift'][1].maxNumericValue).toBe(0.1)
  })

  it('emits bundle-budget.json', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'bundle-budget.json'))).toBe(true)
  })

  it('emits scripts/check-bundle-size.mjs', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'check-bundle-size.mjs'))).toBe(true)
  })

  it('emits total of 12 files for frontend-spa L2 (TS)', () => {
    // 11 quality artifacts + the #1366 render-smoke spec (TS frontends only).
    const result = generateFrontendQuality(
      makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }),
    )
    expect(result.files).toHaveLength(12)
  })

  // ── #1366 (INV-126): render-smoke behavioural spec ───────────────────────────

  it('scaffolds tests/e2e/render-smoke.spec.ts for a TS frontend-spa', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    const spec = join(dir, 'tests', 'e2e', 'render-smoke.spec.ts')
    expect(existsSync(spec)).toBe(true)
    const body = readFileSync(spec, 'utf-8')
    // Boots the SPA, asserts the mount + zero console errors (INV-126).
    expect(body).toMatch(/E2E_BASE_URL/)
    expect(body).toMatch(/console/)
    expect(body).toMatch(/INV-126/)
  })

  it('scaffolds the render-smoke spec when lanes includes frontend (TS, non-spa)', () => {
    generateFrontendQuality(
      makeConfig(dir, {
        archetype: 'backend-web-db',
        lanes: ['frontend', 'backend'],
        governanceLevel: 'L2',
      }),
    )
    expect(existsSync(join(dir, 'tests', 'e2e', 'render-smoke.spec.ts'))).toBe(true)
  })

  it('does NOT scaffold the render-smoke spec for a non-TS frontend', () => {
    const pyDir = createTestProject('python')
    try {
      const result = generateFrontendQuality(
        makeConfig(pyDir, {
          archetype: 'frontend-spa',
          language: 'python',
          governanceLevel: 'L2',
        }),
      )
      expect(existsSync(join(pyDir, 'tests', 'e2e', 'render-smoke.spec.ts'))).toBe(false)
      // Python frontend still gets the other 11 quality artifacts.
      expect(result.files).toHaveLength(11)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ── #352: stylelint design-token config ──────────────────────────────────────
  it('emits .stylelintrc.json with the #352 design-token rules', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.stylelintrc.json'))).toBe(true)
    const cfg = JSON.parse(readFileSync(join(dir, '.stylelintrc.json'), 'utf-8'))
    expect(cfg.rules['color-no-hex']).toBeDefined()
    expect(cfg.rules['length-zero-no-unit']).toBe(true)
    expect(cfg.rules['custom-property-no-missing-var-function']).toBe(true)
  })

  it('injects the stylelint devDep so the CI lint:css gate resolves', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fe', devDependencies: {} }))
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
    expect(pkg.devDependencies.stylelint).toBeTruthy()
  })

  it('does NOT emit .stylelintrc.json for a non-frontend project', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'library' }))
    expect(existsSync(join(dir, '.stylelintrc.json'))).toBe(false)
  })
})
