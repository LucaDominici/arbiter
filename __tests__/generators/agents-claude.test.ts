import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateAgentsClaude } from '../../src/generators/agents-claude.js'

const AGENT_NAMES = ['codebase-scanner', 'red-team'] as const

describe('generateAgentsClaude', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns empty files array when claude is not in tools', () => {
    const config = makeConfig(dir, { tools: ['codex'] })
    const result = generateAgentsClaude(config)
    expect(result.files).toHaveLength(0)
  })

  it('generates 2 agent files for claude projects', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateAgentsClaude(config)
    expect(result.files).toHaveLength(AGENT_NAMES.length)
  })

  it('writes each agent to .claude/agents/<name>.md', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    for (const name of AGENT_NAMES) {
      expect(existsSync(join(dir, '.claude', 'agents', `${name}.md`))).toBe(true)
    }
  })

  it('codebase-scanner agent uses haiku model for cost efficiency', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    const content = readFileSync(join(dir, '.claude', 'agents', 'codebase-scanner.md'), 'utf-8')
    expect(content).toContain('haiku')
  })

  it('codebase-scanner agent is restricted to read-only tools', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    const content = readFileSync(join(dir, '.claude', 'agents', 'codebase-scanner.md'), 'utf-8')
    expect(content).toContain('Grep')
    expect(content).toContain('Glob')
    expect(content).toContain('Read')
    expect(content).not.toContain('Edit')
    expect(content).not.toContain('Write')
  })

  it('red-team agent has a name in frontmatter', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    const content = readFileSync(join(dir, '.claude', 'agents', 'red-team.md'), 'utf-8')
    expect(content).toContain('name: red-team')
  })

  it('each agent file contains frontmatter name and description', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    for (const name of AGENT_NAMES) {
      const content = readFileSync(join(dir, '.claude', 'agents', `${name}.md`), 'utf-8')
      expect(content).toContain(`name: ${name}`)
      expect(content).toMatch(/^description: .+/m)
    }
  })

  it('agent files are marked skipIfExists to avoid overwriting customizations', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    const result = generateAgentsClaude(config)
    expect(result.files).toHaveLength(2)
  })
})
