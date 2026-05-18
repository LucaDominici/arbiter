// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

import {
  hasSuperpowersSkill,
  detectInstalledSkills,
  clearSkillCache,
} from '../../src/integrations/skill-detector.js'

describe('hasSuperpowersSkill (#550)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-skill-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns false when no skill present', () => {
    expect(hasSuperpowersSkill('test-driven-development', dir)).toBe(false)
  })

  it('returns true when local project skill exists', () => {
    const skillDir = join(dir, '.claude', 'skills', 'test-driven-development')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# TDD skill')
    expect(hasSuperpowersSkill('test-driven-development', dir)).toBe(true)
  })

  it('returns false when SKILL.md is missing (directory exists but no file)', () => {
    const skillDir = join(dir, '.claude', 'skills', 'test-driven-development')
    mkdirSync(skillDir, { recursive: true })
    expect(hasSuperpowersSkill('test-driven-development', dir)).toBe(false)
  })

  it('different skill name returns false', () => {
    const skillDir = join(dir, '.claude', 'skills', 'other-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# other')
    expect(hasSuperpowersSkill('test-driven-development', dir)).toBe(false)
  })

  it('returns true when global user skill exists and local is absent', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'arbiter-home-'))
    try {
      const skillDir = join(homeDir, '.claude', 'skills', 'superpowers', 'test-driven-development')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '# TDD global skill')
      expect(hasSuperpowersSkill('test-driven-development', dir, homeDir)).toBe(true)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
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
