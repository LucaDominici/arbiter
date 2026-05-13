import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGemini } from '../../src/generators/gemini.js'

describe('tool output: gemini', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function geminiConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      tools: ['gemini'],
      languageHooks: [],
      ...overrides,
    })
  }

  it('generates .gemini/GEMINI.md at correct path', () => {
    const config = geminiConfig()
    const result = generateGemini(config)
    expect(existsSync(join(dir, '.gemini', 'GEMINI.md'))).toBe(true)
    expect(result.files).toHaveLength(1)
  })

  it('GEMINI.md references AGENTS.md as canonical source', () => {
    const config = geminiConfig()
    generateGemini(config)
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
    expect(content).toContain('canonical')
  })

  it('GEMINI.md contains project name', () => {
    const config = geminiConfig()
    generateGemini(config)
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('GEMINI.md includes TypeScript build and test commands', () => {
    const config = geminiConfig()
    generateGemini(config)
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
  })

  it('GEMINI.md reflects Java/Spring framework in stack table', () => {
    const config = geminiConfig({
      language: 'java',
      framework: 'spring-boot',
      buildTool: 'gradle',
      buildCommand: './gradlew build',
      testCommand: './gradlew test',
    })
    generateGemini(config)
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('java')
    expect(content).toContain('spring-boot')
  })

  it('GEMINI.md gate commands section references check-all.mjs L1 and L2', () => {
    const config = geminiConfig()
    generateGemini(config)
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L1')
    expect(content).toContain('node scripts/check-all.mjs L2')
  })

  it('GEMINI.md contains Gemini-specific task workflow', () => {
    const config = geminiConfig()
    generateGemini(config)
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
    expect(content).toMatch(/task.*workflow|workflow.*task/i)
  })

  it('backs up and replaces pre-existing .gemini/GEMINI.md', () => {
    mkdirSync(join(dir, '.gemini'), { recursive: true })
    writeFileSync(join(dir, '.gemini', 'GEMINI.md'), '# old gemini rules')
    const config = geminiConfig()
    const result = generateGemini(config)
    expect(result.files[0].action).toBe('backed-up-and-replaced')
  })
})
