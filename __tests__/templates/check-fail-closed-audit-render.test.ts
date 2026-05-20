import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const TEMPLATE = 'scripts/check-fail-closed-audit.mjs.ejs'

function renderAt(level: 'L1' | 'L2' | 'L3'): string {
  const data = makeConfig('/tmp/test', {
    governanceLevel: level,
    projectName: 'demo-app',
  }) as unknown as Record<string, unknown>
  return renderTemplate(TEMPLATE, data)
}

describe('check-fail-closed-audit.mjs.ejs — INV-96 audit gate scaffold', () => {
  it('emits nothing at L1 (governance-gated)', () => {
    expect(renderAt('L1').trim()).toBe('')
  })

  it('emits a node script with shebang at L2', () => {
    const out = renderAt('L2')
    expect(out).toContain('#!/usr/bin/env node')
    expect(out).toContain('INV-96')
    expect(out).toContain('demo-app')
  })

  it('emits the same shape at L3', () => {
    const out = renderAt('L3')
    expect(out).toContain('#!/usr/bin/env node')
    expect(out).toContain('INV-96')
  })

  it('declares baseline path and update-baseline flag', () => {
    const out = renderAt('L2')
    expect(out).toContain('scripts/data/fail-closed-baseline.json')
    expect(out).toContain('--update-baseline')
  })

  it('includes the FAIL-OPEN-INTENT allowlist regex', () => {
    const out = renderAt('L2')
    expect(out).toContain('FAIL-OPEN-INTENT')
    expect(out).toContain('FAIL_OPEN_MARK')
  })
})
