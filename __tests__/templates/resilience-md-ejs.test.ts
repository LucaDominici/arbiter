// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// CANON-04 — every .ejs template has a render test.

const TEMPLATE = 'resilience/RESILIENCE.md.ejs'

function cfg(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/test', {
    archetype: 'backend-web-db',
    language: 'typescript',
    governanceLevel: 'L2',
    ...overrides,
  }) as unknown as Record<string, unknown>
}

describe('resilience/RESILIENCE.md.ejs render (#1176)', () => {
  it('renders without EJS leak markers at L2 (typescript)', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('renders without EJS leak markers at L3', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L3' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains cockatiel config block for typescript', () => {
    const out = renderTemplate(TEMPLATE, cfg({ language: 'typescript' }))
    expect(out).toContain('cockatiel')
  })

  it('contains Resilience4j config block for java', () => {
    const out = renderTemplate(TEMPLATE, cfg({ language: 'java' }))
    expect(out).toContain('Resilience4j')
  })

  it('contains both cockatiel and Resilience4j blocks for multi', () => {
    const out = renderTemplate(TEMPLATE, cfg({ language: 'multi' }))
    expect(out).toContain('cockatiel')
    expect(out).toContain('Resilience4j')
  })

  it('contains degrade note for go (not ts/java/multi)', () => {
    const out = renderTemplate(TEMPLATE, cfg({ language: 'go' }))
    expect(out).toMatch(/degrade|language-specific|consult|library/i)
  })

  it('contains degrade note for python (not ts/java/multi)', () => {
    const out = renderTemplate(TEMPLATE, cfg({ language: 'python' }))
    expect(out).toMatch(/degrade|language-specific|consult|library/i)
  })

  it('contains circuit breaker section', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out.toLowerCase()).toContain('circuit')
  })

  it('contains retry/backoff section', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out.toLowerCase()).toContain('retry')
    expect(out.toLowerCase()).toContain('backoff')
  })

  it('contains timeout budget section', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out.toLowerCase()).toContain('timeout')
  })

  it('contains external-call checklist', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out.toLowerCase()).toContain('checklist')
  })

  it('java with absent optional fields (basePackage, framework) renders without throwing', () => {
    // Template reads only `language` and `governanceLevel` — optional fields are unused.
    expect(() =>
      renderTemplate(TEMPLATE, cfg({ language: 'java', basePackage: undefined, framework: null })),
    ).not.toThrow()
  })

  it('L3/L4 enforcement section appears at L3', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L3' }))
    expect(out).toContain('L3/L4 enforcement')
  })

  it('L3/L4 enforcement section appears at L4', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L4' }))
    expect(out).toContain('L3/L4 enforcement')
  })

  it('L3/L4 enforcement section does NOT appear at L2', () => {
    const out = renderTemplate(TEMPLATE, cfg({ governanceLevel: 'L2' }))
    expect(out).not.toMatch(/L3\/L4 enforcement/)
  })
})
