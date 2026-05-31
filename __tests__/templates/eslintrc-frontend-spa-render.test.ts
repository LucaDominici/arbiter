// SPDX-License-Identifier: Apache-2.0
// CANON-04 render tests for boundaries/.eslintrc-frontend-spa.cjs.ejs (#1127)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderEslintFrontendSpa(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'boundaries/.eslintrc-frontend-spa.cjs.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

describe('boundaries/.eslintrc-frontend-spa.cjs.ejs — framework-aware globs (CANON-04, #1127)', () => {
  it('no EJS tag leaks for react', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'react' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks for vue', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'vue' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks for svelte', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'svelte' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks with frontend: undefined (safe default)', () => {
    const rendered = renderEslintFrontendSpa({ frontend: undefined })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('react: boundaries/include contains .tsx and .jsx', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'react' } })
    expect(rendered).toContain('.tsx')
    expect(rendered).toContain('.jsx')
  })

  it('react: boundaries/include does NOT contain .vue', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'react' } })
    expect(rendered).not.toContain('.vue')
  })

  it('vue: boundaries/include contains .vue', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'vue' } })
    expect(rendered).toContain('.vue')
  })

  it('vue: boundaries/include does NOT contain .tsx', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'vue' } })
    expect(rendered).not.toContain('.tsx')
  })

  it('svelte: boundaries/include contains .svelte', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'svelte' } })
    expect(rendered).toContain('.svelte')
  })

  it('svelte: boundaries/include does NOT contain .tsx', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'svelte' } })
    expect(rendered).not.toContain('.tsx')
  })

  it('default (no frontend config): behaves like react — contains .tsx', () => {
    const rendered = renderEslintFrontendSpa()
    expect(rendered).toContain('.tsx')
  })

  it('contains FSD layer boundaries for all frameworks', () => {
    for (const fw of ['react', 'vue', 'svelte'] as const) {
      const rendered = renderEslintFrontendSpa({ frontend: { framework: fw } })
      expect(rendered, `FSD layers missing for ${fw}`).toContain('features')
      expect(rendered, `FSD layers missing for ${fw}`).toContain('entities')
      expect(rendered, `FSD layers missing for ${fw}`).toContain('shared')
    }
  })

  it('vue: uses vuejs-accessibility plugin reference', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'vue' } })
    expect(rendered).toContain('vuejs-accessibility')
  })

  it('react: uses jsx-a11y plugin reference', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'react' } })
    expect(rendered).toContain('jsx-a11y')
  })

  it('svelte: uses eslint-plugin-svelte reference', () => {
    const rendered = renderEslintFrontendSpa({ frontend: { framework: 'svelte' } })
    expect(rendered).toContain('svelte')
  })
})

describe('boundaries/.eslintrc-frontend-spa.cjs.ejs — cross-level stability (CANON-04, #1127)', () => {
  it.each(['L1', 'L2', 'L3', 'L4'] as const)(
    'governance %s: no EJS tag leaks',
    (governanceLevel) => {
      const rendered = renderEslintFrontendSpa({
        governanceLevel,
        frontend: { framework: 'vue' },
      })
      expect(rendered).not.toContain('<%')
      expect(rendered).not.toContain('%>')
    },
  )
})
