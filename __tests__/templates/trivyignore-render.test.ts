import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const POLICY_LIST = 'SQL_INJECTION, XSS, COMMAND_INJECTION, LDAP_INJECTION, HARD_CODE_PASSWORD'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', {
    language: 'java',
    ...overrides,
  }) as unknown as Record<string, unknown>
}

describe('trivyignore.ejs rendering (CANON-04, #208)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('suppressions/trivyignore.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains .trivyignore header comment', () => {
    const out = renderTemplate('suppressions/trivyignore.ejs', cfg())
    expect(out).toContain('# .trivyignore')
  })

  it('contains policy comment with exact no-suppress category list (CANON-15)', () => {
    const out = renderTemplate('suppressions/trivyignore.ejs', cfg())
    expect(out).toContain(POLICY_LIST)
  })

  it('contains exp: format reference for expiry dates', () => {
    const out = renderTemplate('suppressions/trivyignore.ejs', cfg())
    expect(out).toContain('exp:')
  })
})
