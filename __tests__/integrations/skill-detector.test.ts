// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

import { detectInstalledSkills, clearSkillCache } from '../../src/integrations/skill-detector.js'

const FIXTURES = join(import.meta.dirname, '../fixtures/skill-trees')

// ── #1566: detect real skills (no `pluginOwner` frontmatter), guard empty HOME,
//          and never hand callers a mutable shared cache reference ─────────────

describe('detectInstalledSkills production behaviour (#1566)', () => {
  beforeEach(() => clearSkillCache())
  afterEach(() => clearSkillCache())

  it('detects a real upstream skill that has NO pluginOwner frontmatter (path-derived owner)', () => {
    // Mirrors a real superpowers SKILL.md: `name` + `description` only.
    const skills = detectInstalledSkills({
      targetDir: '/nonexistent',
      claudeHome: join(FIXTURES, 'with-superpowers-no-owner'),
    })
    const tdd = skills.find((s) => s.skillId === 'superpowers:test-driven-development')
    expect(tdd).toBeDefined()
    expect(tdd?.pluginOwner).toBe('superpowers')
  })

  it('does NOT scan a CWD-relative plugins/cache when claudeHome is empty', () => {
    const cwdTmp = mkdtempSync(join(tmpdir(), 'arbiter-emptyhome-cwd-'))
    const skillDir = join(cwdTmp, 'plugins', 'cache', 'fakeplug', '1.0.0', 'skills', 'foo')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: foo\nversion: 1.0.0\n---\n# foo\n`)
    const prevCwd = process.cwd()
    try {
      process.chdir(cwdTmp)
      // Sanity: when claudeHome IS supplied, the skill is found.
      clearSkillCache()
      const found = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: cwdTmp })
      expect(found.some((s) => s.skillId === 'fakeplug:foo')).toBe(true)
      // Empty claudeHome must NOT fall back to the relative `plugins/cache` under CWD.
      clearSkillCache()
      const viaEmpty = detectInstalledSkills({ targetDir: '/nonexistent', claudeHome: '' })
      expect(viaEmpty.some((s) => s.skillId === 'fakeplug:foo')).toBe(false)
    } finally {
      process.chdir(prevCwd)
      rmSync(cwdTmp, { recursive: true, force: true })
      clearSkillCache()
    }
  })

  it('returns an immutable result — callers cannot corrupt the shared cache', () => {
    const skills = detectInstalledSkills({
      targetDir: '/nonexistent',
      claudeHome: join(FIXTURES, 'with-superpowers'),
    })
    expect(Object.isFrozen(skills)).toBe(true)
    expect(() => {
      ;(skills as { push: (x: unknown) => void }).push({})
    }).toThrow()
  })
})

// ── Per-session cache (#798) ─────────────────────────────────────────────────

describe('detectInstalledSkills cache (#798)', () => {
  let projectDir: string
  let homeDir: string

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'arbiter-detcache-proj-'))
    homeDir = mkdtempSync(join(tmpdir(), 'arbiter-detcache-home-'))
    clearSkillCache()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
    clearSkillCache()
  })

  function writeSkill(root: string, owner: string, name: string): void {
    const skillDir = join(root, '.claude', 'skills', name)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\npluginOwner: ${owner}\nversion: 1.0.0\n---\n# ${name}\n`,
    )
  }

  it('parses double- and single-quoted frontmatter values (#2373)', () => {
    const quoted = [
      { dir: 'double', quote: '"', name: 'double-quoted', version: '2.0.0' },
      { dir: 'single', quote: "'", name: 'single-quoted', version: '3.0.0' },
    ]
    for (const { dir, quote, name, version } of quoted) {
      const skillDir = join(projectDir, '.claude', 'skills', dir)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${quote}${name}${quote}\npluginOwner: ${quote}quoted${quote}\nversion: ${quote}${version}${quote}\n---\n`,
      )
    }

    const skills = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    expect(skills.map(({ skillId, version }) => ({ skillId, version }))).toEqual([
      { skillId: 'quoted:double-quoted', version: '2.0.0' },
      { skillId: 'quoted:single-quoted', version: '3.0.0' },
    ])
  })

  it('descends into directories and ignores files not named SKILL.md (#2373)', () => {
    writeSkill(projectDir, 'me', 'alpha')
    const skillsRoot = join(projectDir, '.claude', 'skills')
    writeFileSync(join(skillsRoot, 'README.md'), '# Not a skill\n')
    writeFileSync(join(skillsRoot, 'alpha', 'notes.txt'), 'not metadata\n')

    const skills = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    expect(skills.map((skill) => skill.skillId)).toEqual(['me:alpha'])
  })

  it('deduplicates identical skill ids and keeps the first scan-root hit (#2373)', () => {
    writeSkill(projectDir, 'shared', 'alpha')
    const homeSkillDir = join(homeDir, 'skills', 'alpha')
    mkdirSync(homeSkillDir, { recursive: true })
    writeFileSync(
      join(homeSkillDir, 'SKILL.md'),
      '---\nname: alpha\npluginOwner: shared\nversion: 9.0.0\n---\n',
    )

    const skills = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      skillId: 'shared:alpha',
      version: '1.0.0',
      sourcePath: join(projectDir, '.claude', 'skills', 'alpha', 'SKILL.md'),
    })
  })

  it('returns identical array reference on second call (same key)', () => {
    writeSkill(projectDir, 'me', 'alpha')
    const first = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    const second = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    expect(second).toBe(first)
  })

  it('does NOT re-scan after FS mutation (cache is sticky)', () => {
    writeSkill(projectDir, 'me', 'alpha')
    const first = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    expect(first).toHaveLength(1)

    writeSkill(projectDir, 'me', 'beta')
    const second = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    // Cache hit — beta is invisible until clear
    expect(second).toHaveLength(1)
  })

  it('clearSkillCache forces a fresh scan', () => {
    writeSkill(projectDir, 'me', 'alpha')
    const first = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    expect(first).toHaveLength(1)

    writeSkill(projectDir, 'me', 'beta')
    clearSkillCache()
    const second = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
    expect(second).toHaveLength(2)
    expect(second).not.toBe(first)
  })

  it('different targetDir keys produce distinct cache entries', () => {
    const projectDir2 = mkdtempSync(join(tmpdir(), 'arbiter-detcache-proj2-'))
    try {
      writeSkill(projectDir, 'me', 'alpha')
      writeSkill(projectDir2, 'me', 'gamma')
      const first = detectInstalledSkills({ targetDir: projectDir, claudeHome: homeDir })
      const second = detectInstalledSkills({ targetDir: projectDir2, claudeHome: homeDir })
      expect(first.map((s) => s.skillId)).toEqual(['me:alpha'])
      expect(second.map((s) => s.skillId)).toEqual(['me:gamma'])
    } finally {
      rmSync(projectDir2, { recursive: true, force: true })
    }
  })
})
