// Tests for #348 — wire playwright/pytest-playwright execution gate (CANON-02).
//
// The TS Playwright step is migrated from raw existsSync + pushResult to the
// CI-aware runToolCheck helper (#351 helper trinity), wrapped via the
// ephemeral-server runner (#358) so the gate brings up a server before
// invoking Playwright. The Python pytest-playwright step is added under the
// same archetype guard and pattern.

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'

describe('check-all.mjs.ejs — Playwright gate wiring (#348, CANON-02)', () => {
  describe('TypeScript frontend-spa L2', () => {
    const render = (over: Record<string, unknown> = {}) =>
      renderCheckAll(
        makeConfig('/tmp/test', {
          language: 'typescript',
          archetype: 'frontend-spa',
          governanceLevel: 'L2',
          coverageEnabled: false,
          ...over,
        }) as unknown as Record<string, unknown>,
      )

    it('imports runToolCheck from run-helpers', () => {
      const out = render()
      expect(out).toMatch(
        /import\s+\{[\s\S]*?runToolCheck[\s\S]*?\}\s+from\s+'\.\/lib\/run-helpers\.mjs'/,
      )
    })

    it('invokes playwright through the ephemeral-server runner', () => {
      const out = render()
      expect(out).toContain('scripts/lib/ephemeral-server.mjs')
      expect(out).toContain('--start')
      expect(out).toContain('--test')
      expect(out).toContain('npx playwright test')
    })

    it('uses runToolCheck for the playwright gate step', () => {
      const out = render()
      expect(out).toMatch(/runToolCheck\(\s*'playwright e2e'/)
    })

    it('drops the legacy existsSync(node_modules/.bin/playwright) probe', () => {
      const out = render()
      expect(out).not.toContain("existsSync(join('node_modules', '.bin', 'playwright'))")
    })

    it('cites #348 and CANON-02 in the gate-step comment', () => {
      const out = render()
      expect(out).toMatch(/#348/)
      expect(out).toMatch(/CANON-02/)
    })
  })

  describe('TypeScript backend-web-db L2', () => {
    it('emits playwright gate step', () => {
      const out = renderCheckAll(
        makeConfig('/tmp/test', {
          language: 'typescript',
          archetype: 'backend-web-db',
          governanceLevel: 'L2',
          coverageEnabled: false,
        }) as unknown as Record<string, unknown>,
      )
      expect(out).toMatch(/runToolCheck\(\s*'playwright e2e'/)
    })
  })

  describe('TypeScript library L2', () => {
    it('does NOT emit playwright gate step', () => {
      const out = renderCheckAll(
        makeConfig('/tmp/test', {
          language: 'typescript',
          archetype: 'library',
          governanceLevel: 'L2',
          coverageEnabled: false,
        }) as unknown as Record<string, unknown>,
      )
      expect(out).not.toContain("'playwright e2e'")
      expect(out).not.toContain('ephemeral-server.mjs')
    })
  })

  describe('TypeScript frontend-spa L1', () => {
    it('does NOT emit playwright gate step (L1 skips e2e)', () => {
      const out = renderCheckAll(
        makeConfig('/tmp/test', {
          language: 'typescript',
          archetype: 'frontend-spa',
          governanceLevel: 'L1',
          coverageEnabled: false,
        }) as unknown as Record<string, unknown>,
      )
      expect(out).not.toContain("'playwright e2e'")
    })
  })

  describe('Python backend-web-db L2 — pytest-playwright', () => {
    // #2041: check-all.mjs.ejs is registry-driven — render through the shared helper.
    const render = (over: Record<string, unknown> = {}) =>
      renderCheckAll(
        makeConfig('/tmp/test', {
          language: 'python',
          archetype: 'backend-web-db',
          governanceLevel: 'L2',
          coverageEnabled: false,
          ...over,
        }) as unknown as Record<string, unknown>,
      )

    it('emits a pytest-playwright gate step wrapped by the ephemeral-server runner', () => {
      const out = render()
      expect(out).toMatch(/runToolCheck\(\s*'pytest-playwright e2e'/)
      expect(out).toContain('scripts/lib/ephemeral-server.mjs')
      expect(out).toContain('pytest tests/e2e')
    })

    it('cites #348 and CANON-02 in the pytest-playwright comment', () => {
      const out = render()
      expect(out).toMatch(/#348/)
      expect(out).toMatch(/CANON-02/)
    })
  })

  describe('Python library L2', () => {
    it('does NOT emit pytest-playwright gate step', () => {
      const out = renderCheckAll(
        makeConfig('/tmp/test', {
          language: 'python',
          archetype: 'library',
          governanceLevel: 'L2',
          coverageEnabled: false,
        }) as unknown as Record<string, unknown>,
      )
      expect(out).not.toContain("'pytest-playwright e2e'")
    })
  })

  describe('Go frontend-spa L2', () => {
    it('does NOT emit playwright step (TS-only matrix proven cell)', () => {
      const out = renderCheckAll(
        makeConfig('/tmp/test', {
          language: 'go',
          archetype: 'frontend-spa',
          governanceLevel: 'L2',
          coverageEnabled: false,
        }) as unknown as Record<string, unknown>,
      )
      expect(out).not.toContain("'playwright e2e'")
    })
  })
})
