import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateAider } from '../../src/generators/aider.js'

describe('tool output: aider', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function aiderConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      tools: ['aider'],
      languageHooks: [],
      ...overrides,
    })
  }

  it('generates .aider.conf.yml at project root', () => {
    const config = aiderConfig()
    const result = generateAider(config)
    expect(existsSync(join(dir, '.aider.conf.yml'))).toBe(true)
    expect(result.files).toHaveLength(1)
  })

  it('.aider.conf.yml references AGENTS.md', () => {
    const config = aiderConfig()
    generateAider(config)
    const content = readFileSync(join(dir, '.aider.conf.yml'), 'utf-8')
    expect(content).toContain('AGENTS.md')
  })

  it('.aider.conf.yml contains project name', () => {
    const config = aiderConfig()
    generateAider(config)
    const content = readFileSync(join(dir, '.aider.conf.yml'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('.aider.conf.yml includes build and test commands in stack comment', () => {
    const config = aiderConfig()
    generateAider(config)
    const content = readFileSync(join(dir, '.aider.conf.yml'), 'utf-8')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
  })

  it('.aider.conf.yml reflects Java framework in stack comment', () => {
    const config = aiderConfig({
      language: 'java',
      framework: 'spring-boot',
      buildTool: 'gradle',
      buildCommand: './gradlew build',
      testCommand: './gradlew test',
    })
    generateAider(config)
    const content = readFileSync(join(dir, '.aider.conf.yml'), 'utf-8')
    expect(content).toContain('java')
    expect(content).toContain('spring-boot')
  })

  it('.aider.conf.yml references check-all.mjs gate', () => {
    const config = aiderConfig()
    generateAider(config)
    const content = readFileSync(join(dir, '.aider.conf.yml'), 'utf-8')
    expect(content).toContain('check-all.mjs')
  })

  it('.aider.conf.yml has auto-commits: false and AGENTS.md in read list', () => {
    const config = aiderConfig()
    generateAider(config)
    const content = readFileSync(join(dir, '.aider.conf.yml'), 'utf-8')
    expect(content).toContain('auto-commits: false')
    expect(content).toMatch(/read:[\s\S]*AGENTS\.md/)
  })

  it('backs up and replaces pre-existing .aider.conf.yml', () => {
    writeFileSync(join(dir, '.aider.conf.yml'), '# old aider config')
    const config = aiderConfig()
    const result = generateAider(config)
    expect(result.files[0].action).toBe('backed-up-and-replaced')
  })
})
