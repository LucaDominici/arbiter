// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { computeSkipReport } from '../../src/generators/skills.js'
import type { InstalledSkill } from '../../src/integrations/types.js'

// ── #1613 Problem 2: replacement must be version-aware ───────────────────────
// The matrix pins `superpowers:test-driven-development` to `>=5.0.0` and lets it
// replace the built-in `tdd`. An outdated/unverifiable install must NOT silently
// disable the governance built-in.

function tdd(version: string): InstalledSkill {
  return {
    skillId: 'superpowers:test-driven-development',
    pluginOwner: 'superpowers',
    version,
    sourcePath: '/some/SKILL.md',
    role: 'TDD enforcement',
  }
}

describe('findReplacingSkill version gate (#1613)', () => {
  it('replaces the built-in when the installed version satisfies the range', () => {
    const skipped = computeSkipReport([tdd('5.0.0')])
    expect(skipped.map((s) => s.generator)).toContain('tdd')
  })

  it('replaces when the installed version is well above the floor', () => {
    const skipped = computeSkipReport([tdd('6.4.1')])
    expect(skipped.map((s) => s.generator)).toContain('tdd')
  })

  it('does NOT replace when the installed version is below the matrix floor', () => {
    const skipped = computeSkipReport([tdd('3.0.0')])
    expect(skipped.map((s) => s.generator)).not.toContain('tdd')
  })

  it('does NOT replace when the installed version is unknown (no version frontmatter)', () => {
    // Explicit policy: an unverifiable version is not trusted to satisfy a
    // minimum, so it can never suppress a governance built-in.
    const skipped = computeSkipReport([tdd('unknown')])
    expect(skipped.map((s) => s.generator)).not.toContain('tdd')
  })
})
