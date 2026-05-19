// SPDX-License-Identifier: Apache-2.0
// Test guard for #891 — docs/ casing normalization.
// Pure node:fs (no shell exec) per INV-12 / CANON-12 (check-no-direct-spawn.mjs hook).
// Paths anchored to repo root via import.meta.url — independent of process.cwd().

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const r = (rel: string) => resolve(ROOT, rel)

describe('docs/ casing normalization (#891)', () => {
  it('legacy docs/ARCHITECTURE/ directory must not exist', () => {
    // readdirSync is case-exact on all filesystems (avoids false-pass on macOS APFS)
    const entries = readdirSync(r('docs'))
    expect(entries).not.toContain('ARCHITECTURE')
  })

  it('legacy docs/AUDIT/ directory must not exist', () => {
    const entries = readdirSync(r('docs'))
    expect(entries).not.toContain('AUDIT')
  })

  it('README.md must not reference legacy docs/ARCHITECTURE/ path', () => {
    const path = r('README.md')
    expect(existsSync(path), `README.md not found at ${path}`).toBe(true)
    const content = readFileSync(path, 'utf8')
    expect(content).not.toContain('docs/ARCHITECTURE/')
  })

  it('qa-audit-phases.md.ejs (Track B) must not reference legacy docs/AUDIT/ path', () => {
    const path = r('src/templates/governance/qa-audit-phases.md.ejs')
    expect(existsSync(path), `EJS template not found at ${path}`).toBe(true)
    const content = readFileSync(path, 'utf8')
    expect(content).not.toContain('docs/AUDIT/')
  })
})
