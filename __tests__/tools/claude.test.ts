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

  it('generates task.md + ship.md; ship.md is the orchestration entrypoint (#1216)', () => {
    const config = claudeConfig({
      useGitHub: true,
      decompositionBackend: 'github',
    })
    generateClaude(config)
    const commandsDir = join(dir, '.claude', 'commands')
    // Both files generated
    expect(existsSync(join(commandsDir, 'task.md'))).toBe(true)
    expect(existsSync(join(commandsDir, 'ship.md'))).toBe(true)
    expect(existsSync(join(commandsDir, 'start-task.md'))).toBe(false)
    expect(existsSync(join(commandsDir, 'complete-task.md'))).toBe(false)
    // task.md: engine-ref — points at /ship
    const taskContent = readFileSync(join(commandsDir, 'task.md'), 'utf-8')
    expect(taskContent).toContain('/ship')
    // ship.md: orchestration — references the issue (read in preflight)
    const shipContent = readFileSync(join(commandsDir, 'ship.md'), 'utf-8')
    expect(shipContent).toMatch(/read.*issue|issue.*read|preflight/i)
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

  it('generates .claude/rules/60-incidental-capture.md downstream (#1402)', () => {
    generateClaude(claudeConfig())
    expect(existsSync(join(dir, '.claude', 'rules', '60-incidental-capture.md'))).toBe(true)
  })

  it('60-incidental-capture.md mandates arbiter note for out-of-scope findings', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(join(dir, '.claude', 'rules', '60-incidental-capture.md'), 'utf-8')
    expect(content).toMatch(/arbiter note/i)
    expect(content).toMatch(/out.of.scope|outside/i)
  })
})

// ─── Context-economy rule + knowledge-map + track-aware post-commit (#720 #724) ─

describe('generateClaude — context-economy + track-aware post-commit (#720 #724)', () => {
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

  it('generates .claude/rules/40-context-economy.md', () => {
    generateClaude(claudeConfig())
    expect(existsSync(join(dir, '.claude', 'rules', '40-context-economy.md'))).toBe(true)
  })

  it('40-context-economy.md mentions AGENTS.md in minimum startup set', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(join(dir, '.claude', 'rules', '40-context-economy.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
    expect(content).toMatch(/knowledge.map/i)
  })

  it('40-context-economy.md is skipIfExists — does not overwrite existing file', () => {
    generateClaude(claudeConfig())
    const p = join(dir, '.claude', 'rules', '40-context-economy.md')
    writeFileSync(p, 'EXISTING')
    const result = generateClaude(claudeConfig())
    const file = result.files.find((f) => f.path.endsWith('40-context-economy.md'))
    expect(file?.action).toBe('skipped')
  })

  it('generates .claude/knowledge-map.json as valid JSON', () => {
    generateClaude(claudeConfig())
    const raw = readFileSync(join(dir, '.claude', 'knowledge-map.json'), 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('knowledge-map.json contains project name', () => {
    generateClaude(claudeConfig())
    const parsed = JSON.parse(
      readFileSync(join(dir, '.claude', 'knowledge-map.json'), 'utf-8'),
    ) as { project: string }
    expect(parsed.project).toBe('test-project')
  })

  it('knowledge-map.json minimum_startup_set includes AGENTS.md', () => {
    generateClaude(claudeConfig())
    const parsed = JSON.parse(
      readFileSync(join(dir, '.claude', 'knowledge-map.json'), 'utf-8'),
    ) as { minimum_startup_set: string[] }
    expect(parsed.minimum_startup_set).toContain('AGENTS.md')
  })

  it('knowledge-map.json tracks has frontend, backend, docs', () => {
    generateClaude(claudeConfig())
    const parsed = JSON.parse(
      readFileSync(join(dir, '.claude', 'knowledge-map.json'), 'utf-8'),
    ) as { tracks: Record<string, unknown> }
    expect(parsed.tracks).toHaveProperty('frontend')
    expect(parsed.tracks).toHaveProperty('backend')
    expect(parsed.tracks).toHaveProperty('docs')
  })

  it('knowledge-map.json is skipIfExists — does not overwrite existing file', () => {
    generateClaude(claudeConfig())
    const p = join(dir, '.claude', 'knowledge-map.json')
    writeFileSync(p, '{"custom":true}')
    const result = generateClaude(claudeConfig())
    const file = result.files.find((f) => f.path.endsWith('knowledge-map.json'))
    expect(file?.action).toBe('skipped')
  })

  it('generates .claude/hooks/pre-task-track-detect.mjs (#720)', () => {
    generateClaude(claudeConfig())
    expect(existsSync(join(dir, '.claude', 'hooks', 'pre-task-track-detect.mjs'))).toBe(true)
  })

  it('pre-task-track-detect.mjs has shebang', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(
      join(dir, '.claude', 'hooks', 'pre-task-track-detect.mjs'),
      'utf-8',
    )
    expect(content).toMatch(/^#!/)
  })

  it('pre-task-track-detect.mjs references knowledge-map.json', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(
      join(dir, '.claude', 'hooks', 'pre-task-track-detect.mjs'),
      'utf-8',
    )
    expect(content).toContain('knowledge-map.json')
  })

  it('post-commit-check.mjs contains track detection routing (#724)', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(join(dir, '.claude', 'hooks', 'post-commit-check.mjs'), 'utf-8')
    expect(content).toMatch(/track/i)
    expect(content).toMatch(/frontend|tsx|vue/i)
    expect(content).toMatch(/backend|\.go|\.py/i)
  })
})
