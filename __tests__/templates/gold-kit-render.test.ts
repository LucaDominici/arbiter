// SPDX-License-Identifier: Apache-2.0
// CANON-04 / INV-48: render tests for the #1419 downstream gold-audit kit templates.
// One render assertion per EJS file under src/templates/{scripts,standards} that this
// wave adds, so the check-template-tests.mjs ratchet recognises each as tested:
//   scripts/gold-audit.mjs.ejs
//   standards/gold-registry.yml.ejs
//   standards/gold-registry.typescript.yml.ejs
//   standards/gold-registry.java.yml.ejs
//   standards/thresholds.yml.ejs
//   standards/gold-doc-set.yml.ejs
//   standards/doc-profile.ejs
//
// Byte-parity is NOT enforced for src/templates/scripts/** or these data files; the render
// (+ the generator test in __tests__/generators/gold-kit.test.ts) is the contract.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })

describe('scripts/gold-audit.mjs.ejs render (CANON-04, #1419)', () => {
  it('renders a thin runner that delegates to arbiter gold-audit via npx', () => {
    const content = renderTemplate('scripts/gold-audit.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
    expect(content).toContain('arbiter')
    expect(content).toContain('gold-audit')
    expect(content).toContain('npx')
  })
})

describe('standards/*.ejs render (CANON-04, #1419)', () => {
  it('standards/gold-registry.yml.ejs renders a non-empty registry with checks', () => {
    const content = renderTemplate('standards/gold-registry.yml.ejs', config)
    expect(content).toContain('checks:')
    expect(content).toContain('GA-DOC-01')
  })

  it('standards/gold-registry.typescript.yml.ejs renders the TS per-stack registry', () => {
    const content = renderTemplate('standards/gold-registry.typescript.yml.ejs', config)
    expect(content).toContain('TS-CFG-01')
    expect(content).toContain('threshold_ref')
  })

  // #1491 (M5): the TS-CFG-03 ESLint-config check must point at the file arbiter
  // actually emits (`eslint.config.mjs`), not `eslint.config.js` — the old path
  // made the lint-gate-wired check fail-N on every real generated TS project.
  it('TS-CFG-03 checks eslint.config.mjs (the file init actually emits)', () => {
    const content = renderTemplate('standards/gold-registry.typescript.yml.ejs', config)
    expect(content).toMatch(/path:\s*eslint\.config\.mjs/)
    expect(content).not.toMatch(/path:\s*eslint\.config\.js\b/)
  })

  it('standards/gold-registry.java.yml.ejs renders the Java per-stack registry', () => {
    const content = renderTemplate('standards/gold-registry.java.yml.ejs', config)
    expect(content).toContain('JA-BUILD-01')
    expect(content).toContain('threshold_ref')
  })

  it('standards/thresholds.yml.ejs renders the per-class threshold table', () => {
    const content = renderTemplate('standards/thresholds.yml.ejs', config)
    expect(content).toContain('thresholds:')
    expect(content).toContain('gold:')
  })

  it('standards/gold-doc-set.yml.ejs renders the canonical doc-set manifest', () => {
    const content = renderTemplate('standards/gold-doc-set.yml.ejs', config)
    expect(content).toContain('checks:')
    expect(content).toContain('README.md')
  })

  it('standards/doc-profile.ejs renders an empty default overlay profile', () => {
    const content = renderTemplate('standards/doc-profile.ejs', config)
    expect(content).toContain('overlays: []')
    expect(content).toContain('allow: []')
  })
})
