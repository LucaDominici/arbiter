import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'root/docs/METHOD/CONTEXT_SLICE_SPEC.md.ejs'

describe('CONTEXT_SLICE_SPEC.md.ejs render (#993)', () => {
  it('renders without EJS leaks at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains project name when rendered at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2', projectName: 'acme-app' }))
    expect(out).toContain('acme-app')
  })

  it('contains verbatim doctrine at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toContain('Verbatim or Nothing')
    expect(out).toContain('byte-identical')
  })

  it('contains schema block at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).toContain('spec_version')
    expect(out).toContain('sha256')
    expect(out).toContain('emit-context-slice.mjs')
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
