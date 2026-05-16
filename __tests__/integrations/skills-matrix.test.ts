// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { SKILLS_MATRIX } from '../../src/integrations/skills-matrix.js'
import { SKILL_NAMES } from '../../src/generators/skills.js'

describe('SKILLS_MATRIX', () => {
  it('ids are unique', () => {
    const ids = SKILLS_MATRIX.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has required fields', () => {
    for (const entry of SKILLS_MATRIX) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.owner).toBe('string')
      expect(typeof entry.role).toBe('string')
      expect(typeof entry.installCmd).toBe('string')
      expect(['builtin', 'plugin', 'npm']).toContain(entry.installSource)
    }
  })

  it('contains all SKILL_NAMES as builtin entries', () => {
    const builtinIds = SKILLS_MATRIX.filter((e) => e.installSource === 'builtin').map((e) => e.id)
    for (const name of SKILL_NAMES) {
      expect(builtinIds).toContain(name)
    }
  })

  it('contains at least one upstream (non-builtin) entry', () => {
    const upstream = SKILLS_MATRIX.filter((e) => e.installSource !== 'builtin')
    expect(upstream.length).toBeGreaterThan(0)
  })

  it('upstream entries have non-empty installCmd', () => {
    for (const entry of SKILLS_MATRIX.filter((e) => e.installSource !== 'builtin')) {
      expect(entry.installCmd.trim().length).toBeGreaterThan(0)
    }
  })
})
