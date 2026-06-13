// SPDX-License-Identifier: Apache-2.0
// #1330 (CANON-04): render tests for the two new per-lane frontend gate templates.
//   - scripts/check-frontend-lane.mjs.ejs  (the subtree gate script)
//   - github/workflows/18-frontend-lane.yml.ejs  (the subtree CI workflow)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('frontend-lane templates render (#1330, CANON-04)', () => {
  const cfg = makeConfig('/tmp/x', {
    language: 'go',
    archetype: 'library',
    lanes: ['frontend'],
    governanceLevel: 'L2',
  })

  describe('scripts/check-frontend-lane.mjs.ejs', () => {
    const out = renderTemplate('scripts/check-frontend-lane.mjs.ejs', cfg)

    it('is gate-on-present: skips cleanly when the frontend subtree is absent', () => {
      expect(out).toContain("existsSync('frontend/package.json')")
    })

    it('runs typecheck and unit tests inside the frontend subtree (cwd:frontend)', () => {
      expect(out).toContain("cwd: 'frontend'")
      expect(out).toContain('tsc')
      expect(out).toContain('vitest')
    })

    it('runs the build only in full mode', () => {
      expect(out).toContain("mode === 'full'")
      expect(out).toContain('build')
    })

    it('exits non-zero on a real failure of a present step (fail-closed hard gate)', () => {
      expect(out).toContain('process.exit(1)')
    })
  })

  describe('github/workflows/18-frontend-lane.yml.ejs', () => {
    const wf = renderTemplate('github/workflows/18-frontend-lane.yml.ejs', cfg)

    it('triggers only on frontend/** path changes', () => {
      expect(wf).toContain("'frontend/**'")
    })

    it('installs subtree deps with npm ci --prefix frontend', () => {
      expect(wf).toContain('npm ci --prefix frontend')
    })

    it('invokes the lane gate in full mode', () => {
      expect(wf).toContain('node scripts/check-frontend-lane.mjs full')
    })

    it('declares a top-level permissions block (INV-77)', () => {
      expect(wf).toMatch(/^permissions:/m)
    })

    it('uses SHA-pinned third-party action refs (INV-76)', () => {
      // every `uses:` with a third-party action ref must be pinned to a 40-char SHA
      const refs = [...wf.matchAll(/uses:\s*([^\s@]+)@([^\s]+)/g)]
      expect(refs.length).toBeGreaterThan(0)
      for (const [, , ref] of refs) {
        expect(ref).toMatch(/^[0-9a-f]{40}$/)
      }
    })
  })
})
