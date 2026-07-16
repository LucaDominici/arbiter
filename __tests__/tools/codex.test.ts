import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateCodex } from '../../src/generators/codex.js'

describe('tool output: codex', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function codexConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      tools: ['codex'],
      languageHooks: [],
      ...overrides,
    })
  }

  it('CODEX.md references AGENTS.md as canonical source', () => {
    const config = codexConfig()
    generateCodex(config)
    const content = readFileSync(join(dir, '.agents', 'CODEX.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
    expect(content).toContain('canonical')
  })

  it('CODEX.md contains project name in header', () => {
    const config = codexConfig()
    generateCodex(config)
    const content = readFileSync(join(dir, '.agents', 'CODEX.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('CODEX.md includes plan JSON schema with required fields', () => {
    const config = codexConfig()
    generateCodex(config)
    const content = readFileSync(join(dir, '.agents', 'CODEX.md'), 'utf-8')
    expect(content).toContain('PLAN.json')
    expect(content).toContain('run_id')
    expect(content).toContain('task_id')
  })

  it('CODEX.md includes command translation table', () => {
    const config = codexConfig()
    generateCodex(config)
    const content = readFileSync(join(dir, '.agents', 'CODEX.md'), 'utf-8')
    expect(content).toContain('/task')
  })

  it('generates the tool-agnostic rules subset in .agents/rules/', () => {
    const config = codexConfig()
    generateCodex(config)
    const rulesDir = join(dir, '.agents', 'rules')
    for (const f of [
      '05-agent-lifecycle.md',
      '25-todo-folder-policy.md',
      '50-batch-execution.md',
      '60-incidental-capture.md',
      '90-exec-protocol.md',
    ]) {
      expect(existsSync(join(rulesDir, f))).toBe(true)
    }
  })

  // #1586: lock the Claude↔Codex rule delta so the two tracks cannot drift unnoticed.
  // Codex emits only the tool-agnostic rules; the Claude-coupled rules are omitted
  // because each depends on a Claude-only mechanism the Codex track never generates.
  it('omits the Claude-coupled rules (deliberate, locked delta)', () => {
    const config = codexConfig()
    generateCodex(config)
    const rulesDir = join(dir, '.agents', 'rules')
    // 40 → .claude/knowledge-map.json artifact; 55 → post-brainstorm-stop hook + /task;
    // 75 → /impact skill + graphify; 45 → MCP-fallback (Claude MCP config).
    for (const f of [
      '40-context-economy.md',
      '55-brainstorm-terminal-state.md',
      '75-impact-vault-reading.md',
      '45-mcp-fallback.md',
    ]) {
      expect(existsSync(join(rulesDir, f))).toBe(false)
    }
  })

  // ADR-106 (#1966): ALL shared rules are DERIVED from the canonical Claude
  // templates — including 90-exec-protocol, whose parallel Codex copy silently
  // lost the CANON-22 section (the motivating incident).
  it('emitted Codex rules are byte-identical to their Claude template source (all 5, derive-from-Claude)', () => {
    const config = codexConfig()
    generateCodex(config)
    const codexRules = join(dir, '.agents', 'rules')
    const claudeRules = join(process.cwd(), 'src', 'templates', 'claude', 'rules')
    const sources: Record<string, string> = {
      '05-agent-lifecycle.md': '05-agent-lifecycle.md',
      '25-todo-folder-policy.md': '25-todo-folder-policy.md',
      '50-batch-execution.md': '50-batch-execution.md',
      '60-incidental-capture.md': '60-incidental-capture.md',
      '90-exec-protocol.md': '90-exec-protocol.md.ejs',
    }
    for (const [emitted, template] of Object.entries(sources)) {
      expect(readFileSync(join(codexRules, emitted), 'utf-8')).toBe(
        readFileSync(join(claudeRules, template), 'utf-8'),
      )
    }
  })

  it('codex 90-exec-protocol carries the CANON-22 Root-Cause Discipline hard stop (#1966)', () => {
    const config = codexConfig()
    generateCodex(config)
    const rule = readFileSync(join(dir, '.agents', 'rules', '90-exec-protocol.md'), 'utf-8')
    expect(rule).toContain('## Root-Cause Discipline (CANON-22)')
    expect(rule).toContain('arbiter task record-tech-debt')
  })

  // ADR-106: the Known Limitations table is GENERATED from the actual
  // Claude-track inventory — never hand-maintained (the old manual table
  // documented 10 hooks while the Claude track emitted 24).
  it('CODEX.md Known Limitations table is generated from the hook inventory', () => {
    const config = codexConfig()
    generateCodex(config)
    const content = readFileSync(join(dir, '.agents', 'CODEX.md'), 'utf-8')
    const section = content.slice(content.indexOf('## Known Limitations'))
    const rows = section.split('\n').filter((l) => /^\| `[^`]+\.mjs` \|/.test(l))
    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(section).toContain('| `stop-dangerous.mjs` |')
    expect(section).toContain('codex-adapter.mjs')
    // infra plumbing must NOT be presented as an enforcement gap
    expect(section).not.toContain('| `hooks.mjs` |')
    expect(section).not.toContain('| `lib.mjs` |')
    // Claude-only surfaces disclosed with generated counts
    expect(section).toMatch(/\*\*Commands\*\* \(\d+\):/)
    expect(section).toMatch(/\*\*Agents\*\* \(\d+\):/)
    expect(section).toMatch(/\*\*Skills\*\* \(\d+\):/)
    expect(section).toContain('`40-context-economy.md`')
    expect(section).toContain('`95-closer-mode.md`')
  })

  it('generates plan directory README referencing PLAN.json', () => {
    const config = codexConfig()
    generateCodex(config)
    const readme = readFileSync(join(dir, '.agents', 'plan', 'README.md'), 'utf-8')
    expect(readme).toContain('PLAN.json')
  })

  it('result lists exactly 16 files all with created action', () => {
    const config = codexConfig()
    const result = generateCodex(config)
    // CODEX.md (1) + 5 rule files + plan README (1) + codex hooks (9: config.toml +
    // codex-adapter.mjs + lib.mjs + 5 shared guard hooks + check-no-skipped-tests.mjs,
    // #1885) = 16.
    expect(result.files).toHaveLength(16)
    for (const f of result.files) {
      expect(f.action).toBe('created')
    }
  })

  it('rules files use skipIfExists on second run', () => {
    const config = codexConfig()
    // Pre-create one rule file
    const rulesDir = join(dir, '.agents', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, '05-agent-lifecycle.md'), '# existing content')
    const result = generateCodex(config)
    const agentLifecycle = result.files.find((f) => f.path.endsWith('05-agent-lifecycle.md'))
    expect(agentLifecycle?.action).toBe('skipped')
  })
})
