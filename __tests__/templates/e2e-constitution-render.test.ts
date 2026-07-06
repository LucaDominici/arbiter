// SPDX-License-Identifier: Apache-2.0
// #1817 (A4) — E2E_CONSTITUTION.md.ejs structural invariants.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderConstitution(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'e2e/E2E_CONSTITUTION.md.ejs',
    makeConfig('/tmp/test', {
      archetype: 'frontend-spa',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

describe('E2E_CONSTITUTION.md.ejs — structural invariants (#1817, A4)', () => {
  it('renders with no EJS tag leaks', () => {
    const rendered = renderConstitution()
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('is a single-page document (<= 1 page, budget: 220 lines)', () => {
    const rendered = renderConstitution()
    const lineCount = rendered.split('\n').length
    expect(lineCount).toBeLessThanOrEqual(220)
  })

  it('covers all ~10 determinism rules', () => {
    const rendered = renderConstitution()
    expect(rendered).toMatch(/testid/i)
    expect(rendered).toMatch(/fake clock/i)
    expect(rendered).toMatch(/future/i)
    expect(rendered).toMatch(/seed/i)
    expect(rendered).toMatch(/deterministic/i)
    expect(rendered).toMatch(/waitForTimeout|sleep/i)
    expect(rendered).toMatch(/smoke/i)
    expect(rendered).toMatch(/quarantine/i)
    expect(rendered).toMatch(/skip/i)
    expect(rendered).toMatch(/built artifact/i)
  })

  it('references INV-130 / A3 lineage (zero-retry smoke, quarantine TTL)', () => {
    const rendered = renderConstitution()
    expect(rendered).toMatch(/INV-130/)
  })

  it('renders safely for any archetype (no crash)', () => {
    expect(() => renderConstitution({ archetype: 'backend-web-db' })).not.toThrow()
  })
})
