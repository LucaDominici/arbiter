import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const TEMPLATE = 'root/docs/SYSTEM/FAIL_CLOSED.md.ejs'

function renderAt(level: 'L1' | 'L2' | 'L3'): string {
  const data = makeConfig('/tmp/test', {
    governanceLevel: level,
    projectName: 'demo-app',
  }) as unknown as Record<string, unknown>
  return renderTemplate(TEMPLATE, data)
}

describe('FAIL_CLOSED.md.ejs — fail-closed doctrine template', () => {
  it('emits NOTHING at L1 (template body is governance-gated)', () => {
    const out = renderAt('L1').trim()
    expect(out).toBe('')
  })

  it('emits the doctrine at L2 with INV-96 reference', () => {
    const out = renderAt('L2')
    expect(out).toContain('Fail-Closed Doctrine')
    expect(out).toContain('INV-96')
    expect(out).toContain('demo-app')
  })

  it('includes the contract clauses at L2', () => {
    const out = renderAt('L2')
    expect(out).toContain('set -euo pipefail')
    expect(out).toContain('try { … } catch')
    expect(out).toContain('FAIL-OPEN-INTENT')
  })

  it('emits the doctrine at L3 with strict enforcement note', () => {
    const out = renderAt('L3')
    expect(out).toContain('Fail-Closed Doctrine')
    expect(out).toContain('Additional L3 enforcement')
    expect(out).toContain('without** a baseline')
  })

  it('uses governance-appropriate frontmatter tags', () => {
    const out = renderAt('L2')
    expect(out).toMatch(/tags:\s*\[[^\]]*audience\/dev/)
    expect(out).toMatch(/tags:\s*\[[^\]]*kind\/security/)
    expect(out).toMatch(/tags:\s*\[[^\]]*scope\/dual-track/)
  })

  it('shows the anti-pattern catalogue at L2', () => {
    const out = renderAt('L2')
    expect(out).toContain('|| true')
    expect(out).toContain('Swallowed `catch`')
    expect(out).toContain('Default-true booleans')
  })
})
