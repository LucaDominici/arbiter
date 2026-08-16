// SPDX-License-Identifier: Apache-2.0
// #2277 — boundaries/eslint.config.frontend-spa.mjs.ejs, the flat config the
// fsd-boundaries gate actually runs (#1127/#1491).
//
// Same defect class #2272 fixed for hexagonal: 'boundaries/no-unknown' is 'error'
// with no import/resolver, so eslint-plugin-boundaries' bundled
// eslint-import-resolver-node cannot resolve an extensionless relative import
// ('../entities/user') to a .ts file. Every such import classifies as "unknown"
// and false-positives — including clean, rule-compliant FSD code. It is vacuously
// green today only because a fresh FSD scaffold has no cross-layer import to resolve.
//
// Reproduced on a real generated project (arbiter init --archetype frontend-spa,
// eslint-plugin-boundaries@7.2.0): src/features/profile.ts importing
// '../entities/user' — a features -> entities import the FSD rules explicitly ALLOW —
// reported "Dependencies to unknown elements and files are not allowed
// boundaries/no-unknown". Extensions track the framework the same way the file
// globs do, so a Vue/Svelte FSD project resolves its own component files too.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'boundaries/eslint.config.frontend-spa.mjs.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

describe('boundaries/eslint.config.frontend-spa.mjs.ejs — import resolution (#2277)', () => {
  it('configures an import/resolver so relative .ts imports classify instead of "unknown"', () => {
    const out = render({ frontend: { framework: 'react' } })
    expect(out).toContain("'import/resolver'")
    expect(out).toContain(".ts', '.tsx'")
  })

  it('keeps boundaries/no-unknown at error — the rule is fixed, never weakened', () => {
    const out = render({ frontend: { framework: 'react' } })
    expect(out).toContain("'boundaries/no-unknown': 'error'")
  })

  it('vue: resolver extensions include .vue, matching the file globs', () => {
    const out = render({ frontend: { framework: 'vue' } })
    expect(out).toContain("'import/resolver'")
    expect(out).toContain('.vue')
  })

  it('svelte: resolver extensions include .svelte, matching the file globs', () => {
    const out = render({ frontend: { framework: 'svelte' } })
    expect(out).toContain("'import/resolver'")
    expect(out).toContain('.svelte')
  })

  it('no EJS tag leaks in any framework branch, including the undefined default', () => {
    for (const frontend of [
      { framework: 'react' },
      { framework: 'vue' },
      { framework: 'svelte' },
      undefined,
    ]) {
      const out = render({ frontend })
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    }
  })
})
