import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
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

  it('CLAUDE.md delegates hook details to settings.json', () => {
    const config = claudeConfig()
    generateClaude(config)
    const content = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('hooks and permissions are configured in `.claude/settings.json`')
    expect(content).not.toContain('stop-dangerous.mjs')
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

  // #2040 (F-AGENT-08): the prior test only covered rm-rf/force-push, leaving the
  // self-protection entries (ARBITER_* bypass envs, evidence-tamper guards) untested —
  // a regression there would ship silently. Edit(...) only, not Write(...): #2048
  // (merged same day, ancestor of this branch) found Write(path) rules ineffective in
  // Claude Code (only Edit(path) is matched) and removed them as dead/warning-noise.
  it('settings.json deny list blocks every ARBITER_* bypass env and evidence tampering (#2040)', () => {
    const config = claudeConfig()
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { permissions: { deny: string[] } }
    const deny = parsed.permissions.deny
    const ARBITER_BYPASS_ENVS = [
      'ARBITER_GATE_BYPASS',
      'ARBITER_PLAN_BYPASS',
      'ARBITER_SKIP_TDD',
      'ARBITER_SKIP_GATE_MARKER',
      'ARBITER_SSOT_BYPASS',
      'ARBITER_PREPUSH_BYPASS',
      'ARBITER_PREPUSH_SKIP',
      'ARBITER_NO_EVIDENCE',
      'ARBITER_SKIP_DOCS',
    ]
    for (const env of ARBITER_BYPASS_ENVS) {
      expect(
        deny.some((d) => d.includes(env)),
        `deny list missing ${env}`,
      ).toBe(true)
    }
    expect(deny).toContain('Edit(.arbiter/evidence/**)')
    expect(deny).toContain('Edit(.arbiter/gate-pass.json)')
    expect(deny).toContain('Edit(.arbiter/status.json)')
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

  it('generates the always-on and lifecycle rules in .claude/rules/', () => {
    const config = claudeConfig()
    generateClaude(config)
    const rulesDir = join(dir, '.claude', 'rules')
    expect(existsSync(join(rulesDir, '05-agent-lifecycle.md'))).toBe(true)
    expect(existsSync(join(rulesDir, '50-batch-execution.md'))).toBe(true)
    expect(existsSync(join(rulesDir, '60-incidental-capture.md'))).toBe(true)
    expect(existsSync(join(rulesDir, '90-exec-protocol.md'))).toBe(true)
  })

  it('generates exactly the canonical command runbooks', () => {
    generateClaude(claudeConfig({ useGitHub: true, decompositionBackend: 'github' }))
    const commandsDir = join(dir, '.claude', 'commands')
    expect(readdirSync(commandsDir).sort()).toEqual([
      'audit.md',
      'drain.md',
      'impact.md',
      'review.md',
      'ship.md',
      'tabletop.md',
    ])
    expect(readFileSync(join(commandsDir, 'ship.md'), 'utf-8')).toMatch(
      /read.*issue|issue.*read|preflight/i,
    )
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

  it('60-incidental-capture.md mandates arbiter finding add for out-of-scope findings', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(join(dir, '.claude', 'rules', '60-incidental-capture.md'), 'utf-8')
    expect(content).toMatch(/arbiter finding add/i)
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

  it('does not generate deleted context-economy rule', () => {
    generateClaude(claudeConfig())
    expect(existsSync(join(dir, '.claude', 'rules', '40-context-economy.md'))).toBe(false)
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

  it('post-commit-check.mjs is an always-zero advisory without track routing (#2767)', () => {
    generateClaude(claudeConfig())
    const content = readFileSync(join(dir, '.claude', 'hooks', 'post-commit-check.mjs'), 'utf-8')
    expect(content).not.toContain('Track:')
    expect(content).not.toMatch(/hasFE|hasBE|hasDocs/)
    expect(content).toMatch(
      /catch \(error\)[\s\S]*Advisory unavailable:[\s\S]*process\.exitCode = 0/,
    )
  })
})
