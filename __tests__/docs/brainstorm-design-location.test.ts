import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(path), 'utf-8')

describe('#2361 — brainstorm design documents are durable repository docs', () => {
  it('prescribes the tracked docs/design path in the skill, its template, and terminal rule', () => {
    for (const path of [
      '.claude/skills/brainstorming/SKILL.md',
      'src/templates/claude/skills/brainstorming/SKILL.md.ejs',
      '.claude/rules/55-brainstorm-terminal-state.md',
    ]) {
      const content = read(path)
      expect(content).toContain('docs/design/<topic-slug>.md')
      expect(content).not.toContain('.arbiter/design/<topic-slug>.md')
    }
  })

  it('keeps runtime state ignored while docs/design remains committable', () => {
    const ignore = read('.gitignore')
    expect(ignore).toContain('.arbiter/**')
    expect(ignore).toContain('docs/design/ is tracked')

    const result = spawnSync('git', ['check-ignore', '-q', '--', 'docs/design/proof.md'])
    expect(result.status).toBe(1)
  })
})
