// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateSkills } from '../../src/generators/skills.js'
import { makeConfig } from '../helpers.js'
import type { InstalledSkill } from '../../src/integrations/types.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-skill-skip-'))
}

const SUPERPOWERS_TDD: InstalledSkill = {
  skillId: 'superpowers:test-driven-development',
  pluginOwner: 'superpowers',
  version: '5.0.0',
  sourcePath: '/some/path/SKILL.md',
  role: 'TDD enforcement',
}

const SUPERPOWERS_VBC: InstalledSkill = {
  skillId: 'superpowers:verification-before-completion',
  pluginOwner: 'superpowers',
  version: '5.0.0',
  sourcePath: '/some/path/SKILL.md',
  role: 'completion-claim verification',
}

describe('generateSkills with installedSkills', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates all skills when no installed skills detected', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, [])
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.skipped).toHaveLength(0)
    expect(existsSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'skills', 'verification', 'SKILL.md'))).toBe(true)
  })

  it('skips tdd skill when superpowers:test-driven-development detected', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, [SUPERPOWERS_TDD])
    expect(existsSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'))).toBe(false)
    expect(existsSync(join(dir, '.claude', 'skills', 'verification', 'SKILL.md'))).toBe(true)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.generator).toBe('tdd')
    expect(result.skipped[0]?.replacedBy).toBe('superpowers:test-driven-development')
  })

  it('skips multiple skills when multiple installed skills match', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, [SUPERPOWERS_TDD, SUPERPOWERS_VBC])
    expect(existsSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'))).toBe(false)
    expect(existsSync(join(dir, '.claude', 'skills', 'verification', 'SKILL.md'))).toBe(false)
    expect(result.skipped).toHaveLength(2)
    const skippedNames = result.skipped.map((s) => s.generator)
    expect(skippedNames).toContain('tdd')
    expect(skippedNames).toContain('verification')
  })

  it('generates all skills when installed skill has empty replaces', () => {
    const noReplace: InstalledSkill = {
      skillId: 'pr-review-toolkit:code-reviewer',
      pluginOwner: 'pr-review-toolkit',
      version: '1.0.0',
      sourcePath: '/some/path/SKILL.md',
    }
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, [noReplace])
    expect(existsSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'))).toBe(true)
    expect(result.skipped).toHaveLength(0)
  })

  it('returns empty when tools does not include claude', () => {
    const config = makeConfig(dir, { tools: ['codex'] })
    const result = generateSkills(config, [SUPERPOWERS_TDD])
    expect(result.files).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })
})
