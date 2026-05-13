import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateAgentsClaude } from '../../src/generators/agents-claude.js'

describe('brownfield: context-checker and bridge-reviewer agents (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates context-checker.md in .claude/agents/', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    expect(existsSync(join(dir, '.claude', 'agents', 'context-checker.md'))).toBe(true)
  })

  it('generates bridge-reviewer.md in .claude/agents/', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    expect(existsSync(join(dir, '.claude', 'agents', 'bridge-reviewer.md'))).toBe(true)
  })

  it('does not overwrite a pre-existing context-checker.md (skipIfExists)', () => {
    const agentsDir = join(dir, '.claude', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    const original = '# My custom context-checker\nDo not overwrite me.'
    writeFileSync(join(agentsDir, 'context-checker.md'), original)

    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)

    const content = readFileSync(join(agentsDir, 'context-checker.md'), 'utf-8')
    expect(content).toBe(original)
  })

  it('does not overwrite a pre-existing bridge-reviewer.md (skipIfExists)', () => {
    const agentsDir = join(dir, '.claude', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    const original = '# My custom bridge-reviewer\nDo not overwrite me.'
    writeFileSync(join(agentsDir, 'bridge-reviewer.md'), original)

    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)

    const content = readFileSync(join(agentsDir, 'bridge-reviewer.md'), 'utf-8')
    expect(content).toBe(original)
  })

  it('context-checker.md contains CONTEXT_PACK reference', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    const content = readFileSync(join(dir, '.claude', 'agents', 'context-checker.md'), 'utf-8')
    expect(content).toContain('CONTEXT_PACK')
  })

  it('bridge-reviewer.md contains PASS verdict reference', () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateAgentsClaude(config)
    const content = readFileSync(join(dir, '.claude', 'agents', 'bridge-reviewer.md'), 'utf-8')
    expect(content).toContain('PASS')
    expect(content).toContain('REJECT')
  })
})
