import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'root/docs/METHOD/TRACK_MODEL.md.ejs'

describe('TRACK_MODEL.md.ejs render (#975)', () => {
  it('renders without EJS leaks at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains project name when rendered at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2', projectName: 'acme-app' }))
    expect(out).toContain('acme-app')
  })

  it('declares the six tracks at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    for (const track of ['core', 'templates', 'kit', 'docs', 'ci', 'meta']) {
      const re = new RegExp(`^###\\s+\`${track}\``, 'm')
      expect(re.test(out), `track ${track} heading missing`).toBe(true)
    }
  })

  it('each track has Scope, Owners, and CI gate subset bullets at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    for (const track of ['core', 'templates', 'kit', 'docs', 'ci', 'meta']) {
      const section = out.split(new RegExp(`^###\\s+\`${track}\``, 'm'))[1] ?? ''
      expect(section).toContain('**Scope:**')
      expect(section).toContain('**Owners:**')
      expect(section).toContain('**CI gate subset:**')
    }
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
