// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// Covers: src/templates/scripts/constraint-map.json.ejs (INV-115/INV-48, #2037) — the
// scaffolded starter artifact for the constraint-scan gate's fail-closed check.
describe('constraint-map.json.ejs render', () => {
  it('renders to valid JSON with no EJS leaks and a self-documenting schema comment', () => {
    const out = renderTemplate('scripts/constraint-map.json.ejs', makeConfig('/tmp/test'))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    const parsed = JSON.parse(out)
    expect(typeof parsed['//']).toBe('string')
    expect(parsed['//']).toContain('INV-115')
  })
})
