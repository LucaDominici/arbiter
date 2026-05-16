import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAgentsMd } from '../../src/generators/agents-md.js'
import { makeConfig } from '../helpers.js'

describe('generateAgentsMd', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-agents-md-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns a WriteResult with created action', () => {
    const result = generateAgentsMd(makeConfig(dir))
    expect(result.action).toBe('created')
    expect(result.path).toContain('AGENTS.md')
  })

  it('content contains the project name', () => {
    generateAgentsMd(makeConfig(dir, { projectName: 'my-cool-project' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('my-cool-project')
  })

  it('content contains governance level testing policy', () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('L2 (Standard)')
    expect(content).toContain('80% coverage minimum')
  })

  it('content contains build and test commands', () => {
    generateAgentsMd(
      makeConfig(dir, {
        buildCommand: 'npm run build',
        testCommand: 'npm test',
      }),
    )
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
  })

  it('content varies by language — TypeScript invariants', () => {
    generateAgentsMd(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('TypeScript')
    expect(content).toContain('No `any` type')
  })

  it('content varies by language — Java invariants', () => {
    generateAgentsMd(makeConfig(dir, { language: 'java', buildTool: 'gradle' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('Hexagonal architecture')
    expect(content).toContain('No raw types')
  })

  it('content varies by language — Rust invariants', () => {
    generateAgentsMd(makeConfig(dir, { language: 'rust', buildTool: 'cargo' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('No `.unwrap()` calls')
  })

  it('Java AGENTS.md contains RestAssured mandatory policy', () => {
    generateAgentsMd(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('RestAssured')
    expect(content).toMatch(/MockMvc.*forbidden|forbidden.*MockMvc/i)
  })

  it('Java L3 AGENTS.md contains pitest mutation threshold in debt gates', () => {
    generateAgentsMd(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        governanceLevel: 'L3',
        enableDebtGates: true,
      }),
    )
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('pitest')
    expect(content).toContain('mutation')
  })

  it('Java L2 AGENTS.md does NOT contain pitest mutation row (L3-only gate)', () => {
    generateAgentsMd(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        governanceLevel: 'L2',
        enableDebtGates: true,
      }),
    )
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).not.toContain('| Mutation testing (pitest)')
  })

  it('non-Java AGENTS.md does not contain RestAssured or pitest', () => {
    generateAgentsMd(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).not.toContain('RestAssured')
    expect(content).not.toContain('pitest')
  })

  it('Integrations section absent when no skills detected (#556)', () => {
    generateAgentsMd(makeConfig(dir), [], [])
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).not.toContain('## Integrations')
  })

  it('Integrations section rendered when skills detected (#556)', () => {
    const skill = {
      skillId: 'superpowers:test-driven-development',
      pluginOwner: 'superpowers',
      version: '5.0.0',
      sourcePath: '/some/SKILL.md',
      role: 'TDD enforcement',
    }
    const skipReport = [
      {
        generator: 'tdd',
        reason: 'Replaced by superpowers:test-driven-development',
        replacedBy: 'superpowers:test-driven-development',
      },
    ]
    generateAgentsMd(makeConfig(dir), [skill], skipReport)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('## Integrations')
    expect(content).toContain('superpowers:test-driven-development')
    expect(content).toContain('TDD enforcement')
    expect(content).toContain('`tdd`')
    expect(content).toContain('do not regenerate the listed files')
  })

  it('Integrations section renders skill with empty replaces as dash (#556)', () => {
    const skill = {
      skillId: 'pr-review-toolkit:code-reviewer',
      pluginOwner: 'pr-review-toolkit',
      version: '1.0.0',
      sourcePath: '/some/SKILL.md',
    }
    generateAgentsMd(makeConfig(dir), [skill], [])
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('## Integrations')
    expect(content).toContain('pr-review-toolkit:code-reviewer')
    expect(content).toContain('—')
  })
})
