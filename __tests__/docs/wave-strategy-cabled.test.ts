// #2270 — the field-validated wave strategy must be CABLED in both deterministic
// load points (playbook entrypoint + wave-drain skill Iron Law), not memory-only.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const RULES = [
  'Iff-closure contract',
  'RED-first branch construction',
  'regenerate, never hand-resolve',
]

describe('#2270 wave strategy cabled deterministically', () => {
  it('playbook carries the field-validated deltas', () => {
    const s = readFileSync(resolve(ROOT, 'docs/methodology/backlog-drain-playbook.md'), 'utf8')
    expect(s).toContain('Field-validated deltas')
    for (const r of RULES) expect(s).toContain(r)
  })
  it('wave-drain skill Iron Law carries the same rules (both twins)', () => {
    for (const p of [
      '.claude/skills/wave-drain/SKILL.md',
      'src/templates/claude/skills/wave-drain/SKILL.md.ejs',
    ]) {
      const s = readFileSync(resolve(ROOT, p), 'utf8')
      expect(s, p).toContain('Iff-closure contract')
      expect(s, p).toContain('RED-first branch construction')
    }
  })
})
