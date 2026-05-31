// SPDX-License-Identifier: Apache-2.0
// CANON-04 render tests for scripts/check-fe-boundaries.mjs.ejs (#1127)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderFeBoundaries(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'scripts/check-fe-boundaries.mjs.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

describe('scripts/check-fe-boundaries.mjs.ejs — structural invariants (CANON-04, #1127)', () => {
  it('no EJS tag leaks for react', () => {
    const rendered = renderFeBoundaries({ frontend: { framework: 'react' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks for vue', () => {
    const rendered = renderFeBoundaries({ frontend: { framework: 'vue' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks for svelte', () => {
    const rendered = renderFeBoundaries({ frontend: { framework: 'svelte' } })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('no EJS tag leaks with frontend: undefined (safe default)', () => {
    const rendered = renderFeBoundaries({ frontend: undefined })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('react: SOURCE_EXTS includes .tsx', () => {
    const rendered = renderFeBoundaries({ frontend: { framework: 'react' } })
    expect(rendered).toContain('.tsx')
  })

  it('vue: SOURCE_EXTS includes .vue', () => {
    const rendered = renderFeBoundaries({ frontend: { framework: 'vue' } })
    expect(rendered).toContain('.vue')
  })

  it('vue: SOURCE_EXTS does NOT include .tsx', () => {
    const rendered = renderFeBoundaries({ frontend: { framework: 'vue' } })
    // Should not have .tsx in the SOURCE_EXTS set literal
    expect(rendered).not.toContain('".tsx"')
    expect(rendered).not.toContain("'.tsx'")
  })

  it('svelte: SOURCE_EXTS includes .svelte', () => {
    const rendered = renderFeBoundaries({ frontend: { framework: 'svelte' } })
    expect(rendered).toContain('.svelte')
  })

  it('cites INV-102 in output', () => {
    const rendered = renderFeBoundaries()
    expect(rendered).toContain('INV-102')
  })

  it('cites INV-103 in output', () => {
    const rendered = renderFeBoundaries()
    expect(rendered).toContain('INV-103')
  })

  it('cites INV-104 in output', () => {
    const rendered = renderFeBoundaries()
    expect(rendered).toContain('INV-104')
  })

  it('exits with code 1 on violation (exit(1) present)', () => {
    const rendered = renderFeBoundaries()
    expect(rendered).toContain('process.exit(1)')
  })

  it('exits with code 0 on clean (no violations message)', () => {
    const rendered = renderFeBoundaries()
    expect(rendered).toContain('OK (INV-102/103/104)')
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)(
    'governance %s: no EJS tag leaks',
    (governanceLevel) => {
      const rendered = renderFeBoundaries({ governanceLevel, frontend: { framework: 'vue' } })
      expect(rendered).not.toContain('<%')
      expect(rendered).not.toContain('%>')
    },
  )
})
