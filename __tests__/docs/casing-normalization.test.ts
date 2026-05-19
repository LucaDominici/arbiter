// SPDX-License-Identifier: Apache-2.0
// Test guard for #891 — docs/ casing normalization.
// Fails until F1 rename + ref updates land. Pure node:fs (no shell exec) per
// INV-12 / CANON-12 (check-no-direct-spawn.mjs hook).

import { existsSync, readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('docs/ casing normalization (#891)', () => {
  it('legacy docs/ARCHITECTURE/ directory must not exist', () => {
    expect(existsSync('docs/ARCHITECTURE')).toBe(false)
  })

  it('legacy docs/AUDIT/ directory must not exist', () => {
    expect(existsSync('docs/AUDIT')).toBe(false)
  })

  it('README.md must not reference legacy docs/ARCHITECTURE/ path', () => {
    const content = readFileSync('README.md', 'utf8')
    expect(content).not.toContain('docs/ARCHITECTURE/')
  })

  it('qa-audit-phases.md.ejs (Track B) must not reference legacy docs/AUDIT/ path', () => {
    const content = readFileSync('src/templates/governance/qa-audit-phases.md.ejs', 'utf8')
    expect(content).not.toContain('docs/AUDIT/')
  })
})
