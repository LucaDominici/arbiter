import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSkills } from '../../src/generators/skills.js'

const SKILL_NAMES = [
  'tdd',
  'verification',
  'architect-review',
  'clean-code',
  'understand-code',
  'codebase-audit',
  'epic-decompose',
  'configure',
] as const

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
    const result = generateSkills(config, '/nonexistent-home')
    expect(result.files).toHaveLength(0)
  })

  it('generates all 8 skill SKILL.md files for claude projects', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    // Pass non-existent homeDir to prevent global superpowers path from affecting test
    const result = generateSkills(config, '/nonexistent-home')
    expect(result.files).toHaveLength(SKILL_NAMES.length)
  })

  it('skips tdd skill when superpowers test-driven-development skill is present', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    // Simulate a homeDir where the global superpowers skill exists
    const fakeHome = mkdtempSync(join(tmpdir(), 'arbiter-home-'))
    const spSkillDir = join(fakeHome, '.claude', 'skills', 'superpowers', 'test-driven-development')
    mkdirSync(spSkillDir, { recursive: true })
    writeFileSync(join(spSkillDir, 'SKILL.md'), '# TDD skill')
    try {
      const result = generateSkills(config, fakeHome)
      expect(result.files).toHaveLength(SKILL_NAMES.length - 1)
      expect(result.files.every((f) => !f.path.includes('/tdd/'))).toBe(true)
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('writes each skill to .claude/skills/<name>/SKILL.md', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateSkills(config, '/nonexistent-home')
    for (const name of SKILL_NAMES) {
      expect(existsSync(join(dir, '.claude', 'skills', name, 'SKILL.md'))).toBe(true)
    }
  })

  it('tdd skill references vitest for TypeScript projects', () => {
    const config = makeConfig(dir, {
      tools: ['claude'],
      language: 'typescript',
    })
    generateSkills(config, '/nonexistent-home')
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
    generateSkills(config, '/nonexistent-home')
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
    generateSkills(config, '/nonexistent-home')
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
    generateSkills(config, '/nonexistent-home')
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
    generateSkills(config, '/nonexistent-home')
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
    generateSkills(config, '/nonexistent-home')
    const content = readFileSync(
      join(dir, '.claude', 'skills', 'understand-code', 'SKILL.md'),
      'utf-8',
    )
    expect(content).toContain('GLOBAL_INVARIANTS')
  })

  it('each SKILL.md contains a frontmatter name field', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateSkills(config, '/nonexistent-home')
    for (const name of SKILL_NAMES) {
      const content = readFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), 'utf-8')
      expect(content).toContain(`name: ${name}`)
    }
  })

  it('each SKILL.md has a description in frontmatter', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateSkills(config, '/nonexistent-home')
    for (const name of SKILL_NAMES) {
      const content = readFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), 'utf-8')
      expect(content).toMatch(/^description: .+/m)
    }
  })

  it('skill files are marked skipIfExists to avoid overwriting customizations', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateSkills(config, '/nonexistent-home')
    for (const file of result.files) {
      expect(file.skipped !== undefined || file.path.includes('SKILL.md')).toBe(true)
    }
  })
})
