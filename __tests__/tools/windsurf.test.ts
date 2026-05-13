import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateWindsurf } from '../../src/generators/windsurf.js'

describe('tool output: windsurf', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function windsurfConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      tools: ['windsurf'],
      languageHooks: [],
      ...overrides,
    })
  }

  it('generates windsurf-instructions.md at project root', () => {
    const config = windsurfConfig()
    const result = generateWindsurf(config)
    expect(existsSync(join(dir, 'windsurf-instructions.md'))).toBe(true)
    expect(result.files).toHaveLength(1)
  })

  it('windsurf-instructions.md references AGENTS.md as canonical source', () => {
    const config = windsurfConfig()
    generateWindsurf(config)
    const content = readFileSync(join(dir, 'windsurf-instructions.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
    expect(content).toContain('canonical')
  })

  it('windsurf-instructions.md contains project name', () => {
    const config = windsurfConfig()
    generateWindsurf(config)
    const content = readFileSync(join(dir, 'windsurf-instructions.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('windsurf-instructions.md includes TypeScript build and test commands', () => {
    const config = windsurfConfig()
    generateWindsurf(config)
    const content = readFileSync(join(dir, 'windsurf-instructions.md'), 'utf-8')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
  })

  it('windsurf-instructions.md reflects Java/Spring framework in stack table', () => {
    const config = windsurfConfig({
      language: 'java',
      framework: 'spring-boot',
      buildTool: 'gradle',
      buildCommand: './gradlew build',
      testCommand: './gradlew test',
    })
    generateWindsurf(config)
    const content = readFileSync(join(dir, 'windsurf-instructions.md'), 'utf-8')
    expect(content).toContain('java')
    expect(content).toContain('spring-boot')
  })

  it('windsurf-instructions.md gate commands section references check-all.mjs L1 and L2', () => {
    const config = windsurfConfig()
    generateWindsurf(config)
    const content = readFileSync(join(dir, 'windsurf-instructions.md'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L1')
    expect(content).toContain('node scripts/check-all.mjs L2')
  })

  it('windsurf-instructions.md contains Windsurf-specific task workflow', () => {
    const config = windsurfConfig()
    generateWindsurf(config)
    const content = readFileSync(join(dir, 'windsurf-instructions.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
    expect(content).toMatch(/task.*workflow|workflow.*task/i)
  })

  it('backs up and replaces pre-existing windsurf-instructions.md', () => {
    writeFileSync(join(dir, 'windsurf-instructions.md'), '# old windsurf rules')
    const config = windsurfConfig()
    const result = generateWindsurf(config)
    expect(result.files[0].action).toBe('backed-up-and-replaced')
  })
})
