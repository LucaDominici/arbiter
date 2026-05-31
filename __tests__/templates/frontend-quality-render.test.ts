// SPDX-License-Identifier: Apache-2.0
// CANON-04 render tests for frontend-quality templates (#1127)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderVerifyTokens(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'scripts/verify-tokens.mjs.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

function renderDesignTokens(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'frontend/design-tokens.json.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      projectName: 'test-project',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

describe('scripts/verify-tokens.mjs.ejs — structural invariants (CANON-04, #1127)', () => {
  it('no EJS tag leaks for react', () => {
    const rendered = renderVerifyTokens({ frontend: { framework: 'react' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks for vue', () => {
    const rendered = renderVerifyTokens({ frontend: { framework: 'vue' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks for svelte', () => {
    const rendered = renderVerifyTokens({ frontend: { framework: 'svelte' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks with frontend: undefined (safe default)', () => {
    const rendered = renderVerifyTokens({ frontend: undefined })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('cites INV-105', () => {
    const rendered = renderVerifyTokens()
    expect(rendered).toContain('INV-105')
  })

  it('exits with code 1 on violations', () => {
    const rendered = renderVerifyTokens()
    expect(rendered).toContain('process.exit(1)')
  })

  it('vue: SOURCE_EXTS includes .vue', () => {
    const rendered = renderVerifyTokens({ frontend: { framework: 'vue' } })
    expect(rendered).toContain('.vue')
  })

  it('vue: SOURCE_EXTS does NOT include .tsx', () => {
    const rendered = renderVerifyTokens({ frontend: { framework: 'vue' } })
    expect(rendered).not.toContain('".tsx"')
    expect(rendered).not.toContain("'.tsx'")
  })

  it('react: SOURCE_EXTS includes .tsx', () => {
    const rendered = renderVerifyTokens({ frontend: { framework: 'react' } })
    expect(rendered).toContain('.tsx')
  })

  it('svelte: SOURCE_EXTS includes .svelte', () => {
    const rendered = renderVerifyTokens({ frontend: { framework: 'svelte' } })
    expect(rendered).toContain('.svelte')
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)(
    'governance %s: no EJS tag leaks',
    (governanceLevel) => {
      const rendered = renderVerifyTokens({
        governanceLevel,
        frontend: { framework: 'vue' },
      })
      expect(rendered).not.toContain('<%')
      expect(rendered).not.toContain('%>')
    },
  )
})

describe('frontend/design-tokens.json.ejs — structural invariants (CANON-04, #1127)', () => {
  it('no EJS tag leaks', () => {
    const rendered = renderDesignTokens()
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('produces valid JSON', () => {
    const rendered = renderDesignTokens()
    expect(() => JSON.parse(rendered)).not.toThrow()
  })

  it('has $schema field pointing to W3C DTCG', () => {
    const rendered = renderDesignTokens()
    const tokens = JSON.parse(rendered)
    expect(tokens.$schema).toContain('designtokens.org')
  })

  it('has color.bg.primary with $value and $type', () => {
    const rendered = renderDesignTokens()
    const tokens = JSON.parse(rendered)
    expect(tokens.color.bg.primary.$value).toBeTruthy()
    expect(tokens.color.bg.primary.$type).toBe('color')
  })

  it('includes projectName in description', () => {
    const rendered = renderDesignTokens({ projectName: 'my-app' })
    expect(rendered).toContain('my-app')
  })
})
