// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { detectInstalledSkills, clearSkillCache } from '../../src/integrations/skill-detector.js'

// ── #1634: MAX_ENTRIES truncation + derivePluginOwner sentinel collapse ──────

function writeSkill(dir: string, name: string, extra = ''): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${extra}---\n# ${name}\n`)
}

describe('detectInstalledSkills truncation + owner derivation (#1634)', () => {
  let home: string

  beforeEach(() => {
    clearSkillCache()
    home = mkdtempSync(join(tmpdir(), 'arbiter-1634-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    clearSkillCache()
  })

  it('Defect 2: flat version-less layout resolves the real plugin owner, not the "plugin" sentinel', () => {
    // cache/<marketplace>/<plugin>/<hash>/<name>/SKILL.md  (no `skills/` segment)
    writeSkill(
      join(home, 'plugins', 'cache', 'caveman', 'caveman', 'c2ed24b3e5d4', 'caveman-compress'),
      'caveman-compress',
    )
    const skills = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: home })
    const found = skills.find((s) => s.skillId === 'caveman:caveman-compress')
    expect(found).toBeDefined()
    expect(found?.pluginOwner).toBe('caveman')
    // The old sentinel id must NOT appear.
    expect(skills.some((s) => s.skillId === 'plugin:caveman-compress')).toBe(false)
  })

  it('Defect 2: the official skills/-segment layout still derives the right owner', () => {
    writeSkill(
      join(home, 'plugins', 'cache', 'superpowers', '5.0.0', 'skills', 'test-driven-development'),
      'test-driven-development',
    )
    const skills = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: home })
    expect(skills.some((s) => s.skillId === 'superpowers:test-driven-development')).toBe(true)
  })

  it('Defect 2: two flat plugins sharing a skill name keep distinct owners (no dedup collision)', () => {
    writeSkill(join(home, 'plugins', 'cache', 'mkt', 'plugin-a', 'aaa111', 'push-all'), 'push-all')
    writeSkill(join(home, 'plugins', 'cache', 'mkt', 'plugin-b', 'bbb222', 'push-all'), 'push-all')
    const skills = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: home })
    const owners = skills.filter((s) => s.skillId.endsWith(':push-all')).map((s) => s.pluginOwner)
    expect(owners).toContain('plugin-a')
    expect(owners).toContain('plugin-b')
    expect(owners.length).toBe(2)
  })

  it('Defect 1: >500 installed cache skills are all detected (no silent MAX_ENTRIES truncation)', () => {
    const N = 550
    for (let i = 0; i < N; i++) {
      const id = String(i).padStart(4, '0')
      writeSkill(
        join(home, 'plugins', 'cache', 'bulkmkt', `plug-${id}`, 'v1', `skill-${id}`),
        `skill-${id}`,
      )
    }
    const skills = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: home })
    const bulk = skills.filter((s) => s.skillId.startsWith('plug-'))
    expect(bulk.length).toBe(N)
  })

  it('Defect 1: a matrix target that sorts late is still detected past the old 500 cap', () => {
    for (let i = 0; i < 520; i++) {
      const id = String(i).padStart(4, '0')
      writeSkill(join(home, 'plugins', 'cache', 'aaa-mkt', `p-${id}`, 'v1', `s-${id}`), `s-${id}`)
    }
    // Sorts after every `aaa-*` entry above.
    writeSkill(
      join(
        home,
        'plugins',
        'cache',
        'zzz-mkt',
        'superpowers',
        '5.0.0',
        'skills',
        'test-driven-development',
      ),
      'test-driven-development',
    )
    const skills = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: home })
    expect(skills.some((s) => s.skillId === 'superpowers:test-driven-development')).toBe(true)
  })

  it('Defect 1: node_modules and dot-dirs are pruned from the walk', () => {
    writeSkill(join(home, 'plugins', 'cache', 'mkt', 'realplug', 'v1', 'real-skill'), 'real-skill')
    writeSkill(
      join(home, 'plugins', 'cache', 'mkt', 'realplug', 'node_modules', 'dep', 'skills', 'junk'),
      'junk',
    )
    writeSkill(
      join(home, 'plugins', 'cache', 'mkt', 'realplug', '.git', 'hooks', 'sneaky'),
      'sneaky',
    )
    const skills = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: home })
    expect(skills.some((s) => s.skillId.endsWith(':real-skill'))).toBe(true)
    expect(skills.some((s) => s.skillId.endsWith(':junk'))).toBe(false)
    expect(skills.some((s) => s.skillId.endsWith(':sneaky'))).toBe(false)
  })
})
