import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateClaude } from '../../src/generators/claude.js'
import { makeConfig } from '../helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMMANDS_TEMPLATE_DIR = join(__dirname, '..', '..', 'src', 'templates', 'claude', 'commands')

describe('generateClaude', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-claude-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates multiple files including CLAUDE.md', () => {
    const result = generateClaude(makeConfig(dir))
    expect(result.files.length).toBeGreaterThan(1)
    const claudeMd = result.files.find((f) => f.path.endsWith('CLAUDE.md'))
    expect(claudeMd).toBeDefined()
    expect(claudeMd!.action).toBe('created')
  })

  it('CLAUDE.md references AGENTS.md', () => {
    generateClaude(makeConfig(dir))
    const content = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
  })

  it('settings.json is valid JSON with hooks', () => {
    generateClaude(makeConfig(dir))
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).toHaveProperty('hooks')
    expect(parsed).toHaveProperty('permissions')
  })

  it('hook scripts have shebang lines', () => {
    generateClaude(makeConfig(dir))
    const hookContent = readFileSync(join(dir, '.claude', 'hooks', 'stop-dangerous.mjs'), 'utf-8')
    expect(hookContent).toMatch(/^#!/)
  })

  it('generates rules, commands, and hooks directories', () => {
    generateClaude(makeConfig(dir))
    expect(existsSync(join(dir, '.claude', 'rules', '90-exec-protocol.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'commands', 'task.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'commands', 'wt-open.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'commands', 'wt-close.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'commands', 'wt-list.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'commands', 'wt-prune.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'hooks', 'lib.mjs'))).toBe(true)
  })

  it('includes language hooks in dispatcher config table when provided (#248)', () => {
    const config = makeConfig(dir, {
      languageHooks: [
        {
          name: 'check-no-any.mjs',
          description: 'Block any types',
          body: '#!/usr/bin/env bash\necho "checking any"',
        },
      ],
    })
    generateClaude(config)
    // Settings.json uses the dispatcher; individual hook names appear in hooks.mjs config table
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    expect(raw).toContain('hooks.mjs')
    const dispatcherContent = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcherContent).toContain('check-no-any.mjs')
  })

  it('emits hooks.mjs dispatcher at L1 (#248)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'hooks.mjs'))).toBe(true)
    const dispatcher = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcher).toContain('HANDLERS')
    expect(dispatcher).toContain('PreToolUse:Bash')
  })

  it('settings.json uses dispatcher (hooks.mjs) not individual hook filenames (#248)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    expect(raw).toContain('hooks.mjs')
    expect(raw).not.toContain('stop-dangerous.mjs')
    expect(raw).not.toContain('post-commit-check.mjs')
  })

  it('generates pre-compact.mjs and pre-edit-plan-anchor.mjs at L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'pre-compact.mjs'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'hooks', 'pre-edit-plan-anchor.mjs'))).toBe(true)
  })

  it('generates all 6 advanced hooks at L2', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateClaude(config)
    const hooksDir = join(dir, '.claude', 'hooks')
    expect(existsSync(join(hooksDir, 'pre-compact.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'pre-edit-plan-anchor.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'post-edit-dispatch.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'debug-state-on-failure.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'skill-forced-eval.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'guard-task-completion.mjs'))).toBe(true)
  })

  it('does NOT generate L2-only advanced hooks at L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    const hooksDir = join(dir, '.claude', 'hooks')
    expect(existsSync(join(hooksDir, 'post-edit-dispatch.mjs'))).toBe(false)
    expect(existsSync(join(hooksDir, 'debug-state-on-failure.mjs'))).toBe(false)
    expect(existsSync(join(hooksDir, 'skill-forced-eval.mjs'))).toBe(false)
    expect(existsSync(join(hooksDir, 'guard-task-completion.mjs'))).toBe(false)
  })

  it('generates wt-list.md with git worktree list reference', () => {
    generateClaude(makeConfig(dir))
    const content = readFileSync(join(dir, '.claude', 'commands', 'wt-list.md'), 'utf-8')
    expect(content).toContain('git worktree list')
  })

  it('generates wt-open.md with arbiter wt open reference', () => {
    generateClaude(makeConfig(dir))
    const content = readFileSync(join(dir, '.claude', 'commands', 'wt-open.md'), 'utf-8')
    expect(content).toContain('arbiter wt open')
  })

  it('generates wt-close.md with arbiter wt close reference', () => {
    generateClaude(makeConfig(dir))
    const content = readFileSync(join(dir, '.claude', 'commands', 'wt-close.md'), 'utf-8')
    expect(content).toContain('arbiter wt close')
  })

  it('generates wt-prune.md with git worktree prune reference', () => {
    generateClaude(makeConfig(dir))
    const content = readFileSync(join(dir, '.claude', 'commands', 'wt-prune.md'), 'utf-8')
    expect(content).toContain('git worktree prune')
  })

  it('guard-task-completion.mjs is present at L2', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateClaude(config)
    const content = readFileSync(
      join(dir, '.claude', 'hooks', 'guard-task-completion.mjs'),
      'utf-8',
    )
    expect(content).toContain('COMPLETION GUARD')
    expect(content).toContain('task complete')
  })

  it('guard-task-completion.mjs is not present at L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'guard-task-completion.mjs'))).toBe(false)
  })

  it('check-no-placeholders.mjs is emitted at L1 (#151)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-placeholders.mjs'))).toBe(true)
  })

  it('check-no-placeholders is in dispatcher config table for PostToolUse Edit|Write (#151, #248)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    // Settings.json uses dispatcher; hook name appears in hooks.mjs config table
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    expect(raw).toContain('hooks.mjs')
    const dispatcherContent = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcherContent).toContain('check-no-placeholders.mjs')
  })

  it('check-no-unused-exports.mjs is emitted for TypeScript (#156)', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-unused-exports.mjs'))).toBe(true)
  })

  it('check-no-unused-exports.mjs is NOT emitted for non-TypeScript (#156)', () => {
    const config = makeConfig(dir, { language: 'rust' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-unused-exports.mjs'))).toBe(false)
  })

  it('check-no-unused-exports is in dispatcher config table for TypeScript (#156, #248)', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateClaude(config)
    // Settings.json uses dispatcher; hook name appears in hooks.mjs config table
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    expect(raw).toContain('hooks.mjs')
    const dispatcherContent = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcherContent).toContain('check-no-unused-exports.mjs')
  })

  it('check-no-unused-exports is NOT in dispatcher config table for non-TypeScript (#156, #248)', () => {
    const config = makeConfig(dir, { language: 'go' })
    generateClaude(config)
    const dispatcherContent = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcherContent).not.toContain('check-no-unused-exports.mjs')
  })

  it('check-no-unused-exports.mjs is NOT emitted for Java (#156)', () => {
    const config = makeConfig(dir, { language: 'java' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-unused-exports.mjs'))).toBe(false)
  })

  it('check-no-unused-exports.mjs is NOT emitted for Python (#156)', () => {
    const config = makeConfig(dir, { language: 'python' })
    generateClaude(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-unused-exports.mjs'))).toBe(false)
  })

  it('guard-task-completion is in dispatcher config table and UserPromptSubmit in settings.json at L2 (#248)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    // Dispatcher registered for UserPromptSubmit event
    expect(raw).toContain('UserPromptSubmit')
    expect(raw).toContain('hooks.mjs')
    // Handler name in dispatcher config table
    const dispatcherContent = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcherContent).toContain('guard-task-completion.mjs')
  })

  describe('review-code.md SSOT (#236, BLOCKER-10)', () => {
    it('renders TIER_REVIEWER_COUNT values literally — no template drift', async () => {
      generateClaude(makeConfig(dir))
      const content = readFileSync(join(dir, '.claude', 'commands', 'review-code.md'), 'utf-8')
      const { TIER_REVIEWER_COUNT } = await import('../../src/review/tier-constants.js')
      // The rendered table must contain each tier's SSOT count.
      expect(content).toMatch(new RegExp(`\\| XS\\s+\\| ${TIER_REVIEWER_COUNT.XS} \\|`))
      expect(content).toMatch(new RegExp(`\\| S\\s+\\| ${TIER_REVIEWER_COUNT.S} \\|`))
      expect(content).toMatch(new RegExp(`\\| Standard \\| ${TIER_REVIEWER_COUNT.Standard} \\|`))
    })
  })

  describe('command template drift guard (#236)', () => {
    it('every .ejs in src/templates/claude/commands/ is materialized', () => {
      generateClaude(makeConfig(dir))
      const templates = readdirSync(COMMANDS_TEMPLATE_DIR)
        .filter((f) => f.endsWith('.md.ejs'))
        .map((f) => f.replace(/\.ejs$/, ''))
      const commandsDir = join(dir, '.claude', 'commands')
      const materialized = existsSync(commandsDir) ? readdirSync(commandsDir) : []
      // Every template must have a materialized counterpart — prevents
      // adding a new commands/*.ejs without listing it in claude.ts.
      for (const t of templates) {
        expect(materialized).toContain(t)
      }
      // Every materialized .md must have a corresponding template — sanity
      // check the reverse direction too.
      for (const m of materialized) {
        if (m.endsWith('.md')) {
          expect(templates).toContain(m)
        }
      }
    })

    it('review-code.md is materialized (regression: #236 wiring)', () => {
      generateClaude(makeConfig(dir))
      expect(existsSync(join(dir, '.claude', 'commands', 'review-code.md'))).toBe(true)
    })
  })

  describe('taskTiers wiring (#237)', () => {
    it('renders default taskTiers when config.taskTiers is undefined', () => {
      generateClaude(makeConfig(dir))
      const content = readFileSync(join(dir, '.claude', 'commands', 'task.md'), 'utf-8')
      // DEFAULT_TASK_TIERS: XS=3, S=3, Standard=4
      expect(content).toMatch(/Tier XS[\s\S]*?3 review agents/)
      expect(content).toMatch(/Tier S[\s\S]*?3 review agents/)
      expect(content).toMatch(/Tier Standard[\s\S]*?4 review agents/)
    })

    it('renders custom taskTiers from config end-to-end', () => {
      const config = makeConfig(dir, {
        taskTiers: {
          XS: { planDepth: 'minimal', reviewAgentCount: 2 },
          S: { planDepth: 'brief', reviewAgentCount: 5 },
          Standard: { planDepth: 'full', reviewAgentCount: 9 },
        },
      })
      generateClaude(config)
      const content = readFileSync(join(dir, '.claude', 'commands', 'task.md'), 'utf-8')
      expect(content).toMatch(/Tier XS[\s\S]*?2 review agents/)
      expect(content).toMatch(/Tier S[\s\S]*?5 review agents/)
      expect(content).toMatch(/Tier Standard[\s\S]*?9 review agents/)
    })
  })

  describe('existing settings.json — backup (#285)', () => {
    function seedExistingSettingsForBackup(content: string): void {
      const claudeDir = join(dir, '.claude')
      mkdirSync(claudeDir, { recursive: true })
      writeFileSync(join(claudeDir, 'settings.json'), content, 'utf-8')
    }

    it('creates a .arbiter-backup file alongside settings.json when it already exists (#285)', () => {
      const originalContent = JSON.stringify({ permissions: { allow: ['custom'] } })
      seedExistingSettingsForBackup(originalContent)
      const settingsPath = join(dir, '.claude', 'settings.json')
      generateClaude(makeConfig(dir))
      expect(existsSync(`${settingsPath}.arbiter-backup`)).toBe(true)
      expect(readFileSync(`${settingsPath}.arbiter-backup`, 'utf-8')).toBe(originalContent)
    })

    it('does NOT create .arbiter-backup when settings.json does not already exist (#285)', () => {
      const settingsPath = join(dir, '.claude', 'settings.json')
      generateClaude(makeConfig(dir))
      expect(existsSync(`${settingsPath}.arbiter-backup`)).toBe(false)
    })
  })

  describe('existing settings.json — parse guard (#297)', () => {
    function seedExistingSettings(content: string): void {
      const claudeDir = join(dir, '.claude')
      mkdirSync(claudeDir, { recursive: true })
      writeFileSync(join(claudeDir, 'settings.json'), content, 'utf-8')
    }

    it('throws prefixed error on malformed JSON (trailing comma)', () => {
      seedExistingSettings('{"hooks": {},}')
      expect(() => generateClaude(makeConfig(dir))).toThrow(
        /Failed to parse existing \.claude\/settings\.json/,
      )
    })

    it('throws prefixed error when existing settings.json is null', () => {
      seedExistingSettings('null')
      expect(() => generateClaude(makeConfig(dir))).toThrow(
        /Failed to parse existing \.claude\/settings\.json/,
      )
    })

    it('throws prefixed error when existing settings.json is an array', () => {
      seedExistingSettings('[1,2,3]')
      expect(() => generateClaude(makeConfig(dir))).toThrow(
        /Failed to parse existing \.claude\/settings\.json/,
      )
    })

    it('throws prefixed error when existing settings.json is a primitive', () => {
      seedExistingSettings('"a string"')
      expect(() => generateClaude(makeConfig(dir))).toThrow(
        /Failed to parse existing \.claude\/settings\.json/,
      )
    })

    it('merges successfully when existing settings.json is a valid object', () => {
      seedExistingSettings(JSON.stringify({ permissions: { allow: ['custom'] } }))
      expect(() => generateClaude(makeConfig(dir))).not.toThrow()
      const merged = JSON.parse(
        readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'),
      ) as Record<string, unknown>
      expect(merged).toHaveProperty('hooks')
      expect(merged).toHaveProperty('permissions')
    })
  })
})
