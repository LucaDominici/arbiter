import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateClaude } from '../../src/generators/claude.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'

describe('tool output: claude', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function claudeConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, { languageHooks: [], ...overrides })
  }

  it('CLAUDE.md is a thin pointer with @AGENTS.md directive and project name', () => {
    const config = claudeConfig()
    generateClaude(config)
    const content = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('@AGENTS.md')
    expect(content).toContain('test-project')
  })

  it('CLAUDE.md hooks table references all base hook scripts', () => {
    const config = claudeConfig()
    generateClaude(config)
    const content = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('stop-dangerous.mjs')
    expect(content).toContain('enforce-read-only.mjs')
    expect(content).toContain('pre-edit-ssot-guard.mjs')
  })

  it('settings.json is valid JSON with hooks and permissions keys', () => {
    const config = claudeConfig()
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).toHaveProperty('hooks')
    expect(parsed).toHaveProperty('permissions')
  })

  it('settings.json PreToolUse has Bash and Edit|Write matchers', () => {
    const config = claudeConfig()
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as {
      hooks: { PreToolUse: Array<{ matcher: string }> }
    }
    const matchers = parsed.hooks.PreToolUse.map((h) => h.matcher)
    expect(matchers).toContain('Bash')
    expect(matchers).toContain('Edit|Write')
  })

  it('settings.json PostToolUse has Bash and Edit|Write matchers', () => {
    const config = claudeConfig()
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as {
      hooks: { PostToolUse: Array<{ matcher: string }> }
    }
    const matchers = parsed.hooks.PostToolUse.map((h) => h.matcher)
    expect(matchers).toContain('Bash')
    expect(matchers).toContain('Edit|Write')
  })

  it('settings.json deny list blocks rm -rf and force push', () => {
    const config = claudeConfig()
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { permissions: { deny: string[] } }
    const deny = parsed.permissions.deny
    expect(deny.some((d) => d.includes('rm -rf'))).toBe(true)
    expect(deny.some((d) => d.includes('force'))).toBe(true)
  })

  it('generates 5 static hook scripts in .claude/hooks/', () => {
    const config = claudeConfig()
    generateClaude(config)
    const hooksDir = join(dir, '.claude', 'hooks')
    const staticHooks = [
      'stop-dangerous.mjs',
      'enforce-read-only.mjs',
      'pre-edit-ssot-guard.mjs',
      'check-no-orphan-todo.mjs',
      'check-no-skipped-tests.mjs',
    ]
    for (const name of staticHooks) {
      expect(existsSync(join(hooksDir, name)), `${name} should exist`).toBe(true)
    }
  })

  it('lib.mjs contains project name', () => {
    const config = claudeConfig()
    generateClaude(config)
    const content = readFileSync(join(dir, '.claude', 'hooks', 'lib.mjs'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('post-commit-check.mjs contains conventional commit regex', () => {
    const config = claudeConfig()
    generateClaude(config)
    const content = readFileSync(join(dir, '.claude', 'hooks', 'post-commit-check.mjs'), 'utf-8')
    expect(content).toContain('CONVENTIONAL')
    expect(content).toContain('feat')
  })

  it('generates 3 rules files in .claude/rules/', () => {
    const config = claudeConfig()
    generateClaude(config)
    const rulesDir = join(dir, '.claude', 'rules')
    expect(existsSync(join(rulesDir, '05-agent-lifecycle.md'))).toBe(true)
    expect(existsSync(join(rulesDir, '25-todo-folder-policy.md'))).toBe(true)
    expect(existsSync(join(rulesDir, '90-exec-protocol.md'))).toBe(true)
  })

  it('generates 1 command file; task.md references gh issue view for github backend', () => {
    const config = claudeConfig({
      useGitHub: true,
      decompositionBackend: 'github',
    })
    generateClaude(config)
    const commandsDir = join(dir, '.claude', 'commands')
    expect(existsSync(join(commandsDir, 'task.md'))).toBe(true)
    expect(existsSync(join(commandsDir, 'start-task.md'))).toBe(false)
    expect(existsSync(join(commandsDir, 'complete-task.md'))).toBe(false)
    const taskContent = readFileSync(join(commandsDir, 'task.md'), 'utf-8')
    expect(taskContent).toContain('gh issue view')
  })

  it('TypeScript language hooks generate check-no-any.mjs', () => {
    const config = claudeConfig({
      languageHooks: getLanguageHooks('typescript'),
    })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-any.mjs'))).toBe(true)
  })
})

// ─── MCP fallback rule (#721) ─────────────────────────────────────────────────

describe('generateClaude — MCP fallback rule (#721)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function claudeConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, { languageHooks: [], ...overrides })
  }

  it('does NOT generate 45-mcp-fallback.md by default', () => {
    generateClaude(claudeConfig())
    expect(existsSync(join(dir, '.claude', 'rules', '45-mcp-fallback.md'))).toBe(false)
  })

  it('generates .claude/rules/45-mcp-fallback.md when enableMcpFallback is true', () => {
    generateClaude(claudeConfig({ enableMcpFallback: true }))
    expect(existsSync(join(dir, '.claude', 'rules', '45-mcp-fallback.md'))).toBe(true)
  })

  it('45-mcp-fallback.md mentions gh CLI and fallback equivalents', () => {
    generateClaude(claudeConfig({ enableMcpFallback: true }))
    const content = readFileSync(join(dir, '.claude', 'rules', '45-mcp-fallback.md'), 'utf-8')
    expect(content).toMatch(/gh\b/)
    expect(content).toMatch(/fallback/i)
  })

  it('45-mcp-fallback.md is skipIfExists — does not overwrite existing file', () => {
    generateClaude(claudeConfig({ enableMcpFallback: true }))
    const p = join(dir, '.claude', 'rules', '45-mcp-fallback.md')
    writeFileSync(p, 'EXISTING')
    const result = generateClaude(claudeConfig({ enableMcpFallback: true }))
    const file = result.files.find((f) => f.path.endsWith('45-mcp-fallback.md'))
    expect(file?.action).toBe('skipped')
  })
})

// ─── No-skipped-tests hook (#730) ────────────────────────────────────────────

describe('generateClaude — no-skipped-tests hook (#730)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function claudeConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, { languageHooks: [], ...overrides })
  }

  it('generates check-no-skipped-tests.mjs by default', () => {
    generateClaude(claudeConfig())
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-skipped-tests.mjs'))).toBe(true)
  })

  it('does NOT generate check-no-skipped-tests.mjs when enableNoSkippedTests is false', () => {
    generateClaude(claudeConfig({ enableNoSkippedTests: false }))
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-skipped-tests.mjs'))).toBe(false)
  })

  it('check-no-skipped-tests.mjs contains @Disabled and pytest.mark.skip patterns', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(
      join(dir, '.claude', 'hooks', 'check-no-skipped-tests.mjs'),
      'utf-8',
    )
    expect(content).toContain('@Disabled')
    expect(content).toContain('pytest.mark.skip')
  })

  it('check-no-skipped-tests.mjs is skipIfExists', () => {
    generateClaude(claudeConfig())
    const p = join(dir, '.claude', 'hooks', 'check-no-skipped-tests.mjs')
    writeFileSync(p, 'EXISTING')
    const result = generateClaude(claudeConfig())
    const file = result.files.find((f) => f.path.endsWith('check-no-skipped-tests.mjs'))
    expect(file?.action).toBe('skipped')
  })
})

// ─── Batch-execution rule (#722) ─────────────────────────────────────────────

describe('generateClaude — batch-execution rule (#722)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function claudeConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, { languageHooks: [], ...overrides })
  }

  it('generates .claude/rules/50-batch-execution.md', () => {
    generateClaude(claudeConfig())
    expect(existsSync(join(dir, '.claude', 'rules', '50-batch-execution.md'))).toBe(true)
  })

  it('50-batch-execution.md allows read-only parallel agents', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(join(dir, '.claude', 'rules', '50-batch-execution.md'), 'utf-8')
    expect(content).toMatch(/read.only|read only/i)
    expect(content).toMatch(/parallel/i)
  })

  it('50-batch-execution.md prohibits edits/commits in parallel agents', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(join(dir, '.claude', 'rules', '50-batch-execution.md'), 'utf-8')
    expect(content).toMatch(/edit|commit|write/i)
  })

  it('50-batch-execution.md is skipIfExists — does not overwrite existing file', () => {
    generateClaude(claudeConfig())
    const p = join(dir, '.claude', 'rules', '50-batch-execution.md')
    writeFileSync(p, 'EXISTING')
    const result = generateClaude(claudeConfig())
    const file = result.files.find((f) => f.path.endsWith('50-batch-execution.md'))
    expect(file?.action).toBe('skipped')
  })
})
