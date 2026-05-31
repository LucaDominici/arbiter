// SPDX-License-Identifier: Apache-2.0
// CANON-04 render tests for i18n gate scripts (#1127 Slice 3)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderI18nScanner(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'scripts/i18n-literal-scanner.mjs.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

function renderI18nParity(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'scripts/verify-i18n-parity.mjs.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

describe('scripts/i18n-literal-scanner.mjs.ejs — structural invariants (CANON-04, #1127)', () => {
  it('no EJS tag leaks for react', () => {
    const rendered = renderI18nScanner({ frontend: { framework: 'react' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks for vue', () => {
    const rendered = renderI18nScanner({ frontend: { framework: 'vue' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks with frontend: undefined', () => {
    const rendered = renderI18nScanner({ frontend: undefined })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('cites INV-106', () => {
    const rendered = renderI18nScanner()
    expect(rendered).toContain('INV-106')
  })

  it('exits with code 1 on violations', () => {
    const rendered = renderI18nScanner()
    expect(rendered).toContain('process.exit(1)')
  })

  it('vue: scans .vue files', () => {
    const rendered = renderI18nScanner({ frontend: { framework: 'vue' } })
    expect(rendered).toContain('.vue')
  })

  it('react: scans .tsx files', () => {
    const rendered = renderI18nScanner({ frontend: { framework: 'react' } })
    expect(rendered).toContain('.tsx')
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)('governance %s: no EJS tag leaks', (l) => {
    const rendered = renderI18nScanner({ governanceLevel: l })
    expect(rendered).not.toContain('<%')
  })
})

describe('scripts/verify-i18n-parity.mjs.ejs — structural invariants (CANON-04, #1127)', () => {
  it('no EJS tag leaks', () => {
    const rendered = renderI18nParity()
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('cites INV-106', () => {
    const rendered = renderI18nParity()
    expect(rendered).toContain('INV-106')
  })

  it('exits with code 1 on parity failures', () => {
    const rendered = renderI18nParity()
    expect(rendered).toContain('process.exit(1)')
  })

  it('scans locales directory', () => {
    const rendered = renderI18nParity()
    expect(rendered.toLowerCase()).toContain('locale')
  })
})
