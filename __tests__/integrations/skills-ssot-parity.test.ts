// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { SKILLS_MATRIX } from '../../src/integrations/skills-matrix.js'
import { getSkillsMatrixEntries } from '../../src/compatibility/skills-validator.js'

// ── #1613 Problem 3: the two skills SSOTs must agree ─────────────────────────
// `integrations/skills-matrix.ts` (the list/detect SSOT) and
// `compatibility/skills-matrix.json` (the replacement SSOT) previously named
// different skill subsets and the JSON carried a non-existent
// `pr-review-toolkit:code-reviewer` id. After reconciliation every upstream id
// the list recommends must exist in the replacement matrix.

describe('skills SSOT parity (#1613)', () => {
  const jsonIds = new Set(getSkillsMatrixEntries().map((e) => e.skillId))
  const upstreamIds = SKILLS_MATRIX.filter((e) => e.installSource === 'plugin').map((e) => e.id)

  it('every recommended upstream id exists in the replacement matrix (UPSTREAM ⊆ JSON)', () => {
    for (const id of upstreamIds) {
      expect(jsonIds.has(id)).toBe(true)
    }
  })

  it('uses the real installable pr-review-toolkit id (review-pr), not the phantom code-reviewer', () => {
    expect(jsonIds.has('pr-review-toolkit:review-pr')).toBe(true)
    expect(jsonIds.has('pr-review-toolkit:code-reviewer')).toBe(false)
  })
})
