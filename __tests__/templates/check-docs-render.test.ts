import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'scripts/check-docs.mjs.ejs'

describe('check-docs template (#356, CANON-01)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('starts with a Node shebang', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out.trimStart()).toMatch(/^#!\/usr\/bin\/env node/)
  })

  it('honors the [skip-docs] bypass token in commit messages', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).toContain('[skip-docs]')
  })

  it('uses git merge-base for rebased-aware diff range', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).toContain('merge-base')
  })

  it('checks code paths (src/, __tests__/) require docs', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).toContain('src/')
    expect(out).toContain('docs/')
  })
})
