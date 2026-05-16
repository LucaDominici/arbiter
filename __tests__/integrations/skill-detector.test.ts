// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

import { hasSuperpowersSkill } from '../../src/integrations/skill-detector.js'

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
