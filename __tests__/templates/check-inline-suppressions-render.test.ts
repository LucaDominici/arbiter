import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('check-inline-suppressions.mjs.ejs rendering (CANON-04)', () => {
  function render() {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    return renderTemplate('scripts/check-inline-suppressions.mjs.ejs', data)
  }

  it('contains paren-call directive parser regex', () => {
    expect(render()).toContain('arbiter-suppress(')
  })

  it('contains REASON_MIN_LEN constant or import', () => {
    const content = render()
    expect(content).toMatch(/REASON_MIN_LEN|reason.*10/)
  })

  it('contains INV catalog loading logic', () => {
    expect(render()).toContain('INV-')
  })

  it('contains checkExpiry or validateEntry call', () => {
    const content = render()
    expect(content).toMatch(/checkExpiry|validateEntry/)
  })

  it('scans subdirectories recursively', () => {
    expect(render()).toContain('readdirSync')
  })

  it('exits with non-zero on failures', () => {
    expect(render()).toContain('process.exit')
  })
})
