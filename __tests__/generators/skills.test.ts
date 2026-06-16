import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSkills } from '../../src/generators/skills.js'
import type { InstalledSkill } from '../../src/integrations/types.js'

const SKILL_NAMES = [
  'tdd',
  'verification',
  'architect-review',
  'clean-code',
  'understand-code',
  'codebase-audit',
  'epic-decompose',
  'configure',
  'brainstorming',
  'wave-drain',
  'impact',
  'gold-audit',
  'close-gold-gap',
  'levelup',
] as const

const SUPERPOWERS_TDD: InstalledSkill = {
  skillId: 'superpowers:test-driven-development',
  pluginOwner: 'superpowers',
  version: '5.0.0',
  sourcePath: '/some/SKILL.md',
  role: 'TDD enforcement',
}

describe('generateSkills', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns empty files array when claude is not in tools', () => {
    const config = makeConfig(dir, { tools: ['codex'] })
    const result = generateSkills(config, [])
    expect(result.files).toHaveLength(0)
  })

  it('generates all built-in skill SKILL.md files for claude projects', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, [])
    expect(result.files).toHaveLength(SKILL_NAMES.length)
  })

  it('skips tdd skill when superpowers test-driven-development skill is present', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, [SUPERPOWERS_TDD])
    expect(result.files).toHaveLength(SKILL_NAMES.length - 1)
    expect(result.files.every((f) => !f.path.includes('/tdd/'))).toBe(true)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.generator).toBe('tdd')
  })

  it('writes each skill to .claude/skills/<name>/SKILL.md', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateSkills(config, [])
    for (const name of SKILL_NAMES) {
      expect(existsSync(join(dir, '.claude', 'skills', name, 'SKILL.md'))).toBe(true)
    }
  })

  it('tdd skill references vitest for TypeScript projects', () => {
    const config = makeConfig(dir, {
      tools: ['claude'],
      language: 'typescript',
    })
    generateSkills(config, [])
    const content = readFileSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'), 'utf-8')
    expect(content).toContain('vitest')
  })

  it('tdd skill references JUnit for Java projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      tools: ['claude'],
      language: 'java',
    })
    generateSkills(config, [])
    const content = readFileSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'), 'utf-8')
    expect(content).toContain('JUnit')
  })

  it('tdd skill references pytest for Python projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('python')
    const config = makeConfig(dir, {
      tools: ['claude'],
      language: 'python',
    })
    generateSkills(config, [])
    const content = readFileSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'), 'utf-8')
    expect(content).toContain('pytest')
  })

  it('tdd skill references testing package for Go projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('go')
    const config = makeConfig(dir, {
      tools: ['claude'],
      language: 'go',
    })
    generateSkills(config, [])
    const content = readFileSync(join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'), 'utf-8')
    expect(content).toContain('testing')
  })

  it('architect-review skill references package structure for Java projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      tools: ['claude'],
      language: 'java',
    })
    generateSkills(config, [])
    const content = readFileSync(
      join(dir, '.claude', 'skills', 'architect-review', 'SKILL.md'),
      'utf-8',
    )
    expect(content).toContain('package')
  })

  it('understand-code skill references GLOBAL_INVARIANTS for standard/full preset projects', () => {
    const config = makeConfig(dir, {
      tools: ['claude'],
      governanceLevel: 'L2',
    })
    generateSkills(config, [])
    const content = readFileSync(
      join(dir, '.claude', 'skills', 'understand-code', 'SKILL.md'),
      'utf-8',
    )
    expect(content).toContain('GLOBAL_INVARIANTS')
  })

  it('each SKILL.md contains a frontmatter name field', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateSkills(config, [])
    for (const name of SKILL_NAMES) {
      const content = readFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), 'utf-8')
      expect(content).toContain(`name: ${name}`)
    }
  })

  it('each SKILL.md has a description in frontmatter', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateSkills(config, [])
    for (const name of SKILL_NAMES) {
      const content = readFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), 'utf-8')
      expect(content).toMatch(/^description: .+/m)
    }
  })

  it('skill files are marked skipIfExists to avoid overwriting customizations', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, [])
    for (const file of result.files) {
      expect(file.skipped !== undefined || file.path.includes('SKILL.md')).toBe(true)
    }
  })

  // #1420 — /gold-audit skill: read-only measurement front door over the
  // deterministic `arbiter gold-audit --json` engine. No AI re-scoring.
  describe('gold-audit skill (#1420)', () => {
    it('SKILL_NAMES registry includes gold-audit', () => {
      expect(SKILL_NAMES).toContain('gold-audit')
    })

    it('writes .claude/skills/gold-audit/SKILL.md', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      expect(existsSync(join(dir, '.claude', 'skills', 'gold-audit', 'SKILL.md'))).toBe(true)
    })

    it('invokes the existing CLI engine (no re-implemented scoring)', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      const content = readFileSync(
        join(dir, '.claude', 'skills', 'gold-audit', 'SKILL.md'),
        'utf-8',
      )
      expect(content).toContain('arbiter gold-audit --json')
      // Reads the payload verbatim — level/score/checks — never re-scores.
      expect(content).toContain('level')
      expect(content).toContain('checks')
    })

    it('is documented as read-only (measures, never changes code)', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      const content = readFileSync(
        join(dir, '.claude', 'skills', 'gold-audit', 'SKILL.md'),
        'utf-8',
      )
      expect(content).toMatch(/read-only/i)
    })

    it('points at arbiter init/update as the graceful fallback', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      const content = readFileSync(
        join(dir, '.claude', 'skills', 'gold-audit', 'SKILL.md'),
        'utf-8',
      )
      expect(content).toMatch(/arbiter (init|update)/)
    })
  })

  // #1421 — /levelup orchestrator skill: the honest level-up loop that raises a
  // governed project's gold level by REAL remediation (gold-audit → compose a
  // remediation wave → close each gap honestly → re-audit ratchet), gated on the
  // no-regress + anti-fake-green guards (fail-closed). No new TS engine.
  describe('levelup skill (#1421)', () => {
    it('SKILL_NAMES registry includes levelup', () => {
      expect(SKILL_NAMES).toContain('levelup')
    })

    it('writes .claude/skills/levelup/SKILL.md', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      expect(existsSync(join(dir, '.claude', 'skills', 'levelup', 'SKILL.md'))).toBe(true)
    })

    it('composes the existing gold-audit + close-gold-gap CLIs (no new engine)', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      const content = readFileSync(join(dir, '.claude', 'skills', 'levelup', 'SKILL.md'), 'utf-8')
      expect(content).toContain('arbiter gold-audit')
      expect(content).toContain('close-gold-gap')
    })

    it('gates each wave on the no-regress + anti-fake-green guards (fail-closed)', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      const content = readFileSync(join(dir, '.claude', 'skills', 'levelup', 'SKILL.md'), 'utf-8')
      expect(content).toContain('gold-audit --check')
      expect(content).toMatch(/anti-fake-green/i)
      expect(content).toMatch(/fail-closed/i)
    })

    it('routes un-closeable gaps to needs-human, never fakes a green', () => {
      const config = makeConfig(dir, { tools: ['claude'] })
      generateSkills(config, [])
      const content = readFileSync(join(dir, '.claude', 'skills', 'levelup', 'SKILL.md'), 'utf-8')
      expect(content).toMatch(/needs-human/i)
    })
  })
})
