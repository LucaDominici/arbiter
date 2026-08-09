// SPDX-License-Identifier: Apache-2.0
// CANON-04: render test for root/docs/METHOD/REUSE_REGISTRY.md.ejs (INV-70). The
// companion spec doc (REUSE_REGISTRY_SPEC.md.ejs) has its own render test in
// reuse-registry-spec-render.test.ts — this file covers the registry itself.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'root/docs/METHOD/REUSE_REGISTRY.md.ejs'

describe('REUSE_REGISTRY.md.ejs render (INV-70)', () => {
  it('renders without EJS leaks at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains project name when rendered at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2', projectName: 'acme-app' }))
    expect(out).toContain('acme-app')
  })

  it('contains the registered-modules and prior-search sections at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toMatch(/##\s+Moduli registrati/)
    expect(out).toMatch(/##\s+Ricerca documentata dell'esistente/)
  })

  it('emits empty body at L1 (L2+ guard)', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L1' }))
    expect(out.trim()).toBe('')
  })

  it('renders identically at L2 and L3', () => {
    const l2 = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    const l3 = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L3' }))
    expect(l2).toBe(l3)
  })
})
