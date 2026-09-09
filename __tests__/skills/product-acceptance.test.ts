// SPDX-License-Identifier: Apache-2.0
// #2535 — this regression pins the skill's discoverable contract, not a prose parser.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const skillPath = join(repoRoot, '.claude', 'skills', 'product-acceptance', 'SKILL.md')
const delegatedSkills = ['tabletop', 'verification', 'refutation', 'visual-verification'] as const

function skillText(): string {
  return readFileSync(skillPath, 'utf-8')
}

describe('product-acceptance SKILL.md (#2535)', () => {
  it('is discoverable at its canonical path with native frontmatter and live related-skill references (AC-2535.1/2)', () => {
    expect(existsSync(skillPath)).toBe(true)
    if (!existsSync(skillPath)) return

    const text = skillText()
    for (const field of [
      'name: product-acceptance',
      'description:',
      'title:',
      'doc_version:',
      'status: active',
      'last_review:',
      'owner:',
      'canonical_id:',
      'tags:',
      'related:',
    ]) {
      expect(text).toContain(field)
    }
    for (const skill of delegatedSkills) {
      expect(text).toContain(skill)
      expect(existsSync(join(repoRoot, '.claude', 'skills', skill, 'SKILL.md'))).toBe(true)
    }
  })

  it('keeps the session-sheet output contract honest about covered and uncovered work (AC-2535.3)', () => {
    expect(existsSync(skillPath)).toBe(true)
    if (!existsSync(skillPath)) return

    const text = skillText()
    expect(text).toContain('Result matrix')
    expect(text).toContain('findings.jsonl')
    expect(text).toContain('NOT COVERED')
    expect(text).toContain('Effort split')
    expect(text).toContain('Charter versus opportunity')
    expect(text).toContain('Obstacles and outlook')
  })
})
