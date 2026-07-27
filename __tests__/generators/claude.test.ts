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
import { spawnSync } from 'node:child_process'
import { generateClaude } from '../../src/generators/claude.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'
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

  it('dry-run over an existing divergent settings.json reports the merge without touching disk', () => {
    // First real run materializes settings.json, then diverge it so the merge
    // path (not the skip path) is taken on the second, dry-run pass.
    generateClaude(makeConfig(dir))
    const settingsPath = join(dir, '.claude', 'settings.json')
    const diverged = JSON.stringify({ userCustomKey: true }, null, 2) + '\n'
    writeFileSync(settingsPath, diverged)

    const result = generateClaude(makeConfig(dir), { dryRun: true })

    const settings = result.files.find((f) => f.path.endsWith('settings.json'))
    expect(settings?.action).toBe('backed-up-and-replaced')
    // dry run NEVER mutates: no merged write, no backup file
    expect(readFileSync(settingsPath, 'utf-8')).toBe(diverged)
    expect(existsSync(`${settingsPath}.arbiter-backup`)).toBe(false)
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

  it('emits the impact-first editing rule directing /impact before editing (#1448)', () => {
    generateClaude(makeConfig(dir))
    const rulePath = join(dir, '.claude', 'rules', '75-impact-vault-reading.md')
    expect(existsSync(rulePath)).toBe(true)
    const content = readFileSync(rulePath, 'utf-8')
    expect(content).toContain('/impact')
    expect(content).toMatch(/blast radius/i)
    expect(content).toMatch(/before .*edit/i)
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

  it('generates all advanced hooks at L2 (incl. stop-evidence-guard, #1212)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateClaude(config)
    const hooksDir = join(dir, '.claude', 'hooks')
    expect(existsSync(join(hooksDir, 'pre-compact.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'pre-edit-plan-anchor.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'post-edit-dispatch.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'debug-state-on-failure.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'skill-forced-eval.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'guard-task-completion.mjs'))).toBe(true)
    expect(existsSync(join(hooksDir, 'stop-evidence-guard.mjs'))).toBe(true)
    // #1331: exitplanmode-banner.mjs is registered in hooks.mjs HANDLERS at L2+;
    // it must now actually be emitted (was dead config — registered, never written).
    expect(existsSync(join(hooksDir, 'exitplanmode-banner.mjs'))).toBe(true)
  })

  it('AC-8 dispatches every newly emitted enforcement hook through a wired event', () => {
    generateClaude(makeConfig(dir, { language: 'go', governanceLevel: 'L2' }))
    const dispatcher = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    const settings = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    expect(dispatcher).toContain("'PreToolUse:Task|Agent'")
    expect(dispatcher).toContain("'pre-spawn-worktree-guard.mjs'")
    expect(dispatcher).toContain("'stop-finding-loss.mjs'")
    expect(settings).toContain('"matcher": "Task|Agent"')
    expect(settings).toContain('PreToolUse:Task|Agent')
  })

  it('AC-8 dispatcher fails closed when a registered handler file is missing', () => {
    generateClaude(makeConfig(dir, { language: 'go', governanceLevel: 'L2' }))
    rmSync(join(dir, '.claude', 'hooks', 'pre-spawn-worktree-guard.mjs'))
    const result = spawnSync(
      'node',
      [join(dir, '.claude', 'hooks', 'hooks.mjs'), 'PreToolUse:Task|Agent'],
      {
        cwd: dir,
        input: JSON.stringify({ tool_input: {} }),
        encoding: 'utf-8',
      },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('pre-spawn-worktree-guard.mjs')
  })

  it.each([
    ['typescript', 'check-no-any.mjs', 'unsafe.ts', 'const value: any = 1\n'],
    ['rust', 'check-no-unwrap.mjs', 'unsafe.rs', 'fn main() { result.unwrap(); }\n'],
    ['go', 'check-no-unchecked-err.mjs', 'unsafe.go', '_ = doWork()\n'],
    ['python', 'check-no-bare-except.mjs', 'unsafe.py', 'try:\n  work()\nexcept:\n  pass\n'],
    ['java', 'check-no-raw-types.mjs', 'Unsafe.java', 'class Unsafe { List values; }\n'],
    ['java', 'check-no-mockmvc.mjs', 'UnsafeTest.java', 'class UnsafeTest { MockMvc mvc; }\n'],
  ] as const)(
    'AC-4 emits a blocking exit for a %s language-hook violation (%s)',
    (language, hookName, fileName, content) => {
      generateClaude(
        makeConfig(dir, {
          language,
          governanceLevel: 'L2',
          languageHooks: getLanguageHooks(language),
        }),
      )
      const sourcePath = join(dir, fileName)
      writeFileSync(sourcePath, content)

      const result = spawnSync('node', [join(dir, '.claude', 'hooks', hookName)], {
        cwd: dir,
        input: JSON.stringify({ tool_input: { file_path: sourcePath } }),
        encoding: 'utf-8',
      })

      expect(result.status).toBe(2)
    },
  )

  it('does NOT generate L2-only advanced hooks at L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateClaude(config)
    const hooksDir = join(dir, '.claude', 'hooks')
    expect(existsSync(join(hooksDir, 'post-edit-dispatch.mjs'))).toBe(false)
    expect(existsSync(join(hooksDir, 'debug-state-on-failure.mjs'))).toBe(false)
    expect(existsSync(join(hooksDir, 'skill-forced-eval.mjs'))).toBe(false)
    expect(existsSync(join(hooksDir, 'guard-task-completion.mjs'))).toBe(false)
    expect(existsSync(join(hooksDir, 'stop-evidence-guard.mjs'))).toBe(false)
    // #1331: exitplanmode-banner.mjs is an L2+ advanced hook — absent at L1.
    expect(existsSync(join(hooksDir, 'exitplanmode-banner.mjs'))).toBe(false)
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

  it.each([
    ['go', '.go'],
    ['python', '.py'],
    ['rust', '.rs'],
    ['java', '.java'],
    ['kotlin', '.kt'],
    ['multi', '.java'],
  ] as const)(
    'AC-9 renders both content-policy hooks to block native %s source',
    (language, extension) => {
      generateClaude(makeConfig(dir, { language, governanceLevel: 'L2' }))
      const source = join(dir, `probe${extension}`)
      const runHook = (name: string) =>
        spawnSync('node', [join(dir, '.claude', 'hooks', name)], {
          cwd: dir,
          env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: source },
          encoding: 'utf-8',
        })

      writeFileSync(source, '// ' + 'TODO: missing task id\n')
      expect(runHook('check-no-orphan-todo.mjs').status).toBe(2)

      writeFileSync(source, '// FIX' + 'ME: unfinished\n')
      expect(runHook('check-no-placeholders.mjs').status).toBe(2)
    },
  )

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

  it('registers the Stop event in settings.json + dispatcher at L2 (#1212/INV-114)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateClaude(config)
    const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')
    expect(raw).toContain('"Stop"')
    expect(JSON.parse(raw).hooks.Stop).toBeDefined()
    const dispatcherContent = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcherContent).toContain('stop-evidence-guard.mjs')
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
  })

  describe('taskTiers wiring (#237, #1216)', () => {
    // #1216: Tier content moved from task.md (engine-ref) to ship.md (orchestration).
    it('renders default taskTiers when config.taskTiers is undefined', () => {
      generateClaude(makeConfig(dir))
      // task.md is now the engine/CLI reference — tier blocks are in ship.md
      const taskContent = readFileSync(join(dir, '.claude', 'commands', 'task.md'), 'utf-8')
      const shipContent = readFileSync(join(dir, '.claude', 'commands', 'ship.md'), 'utf-8')
      // task.md: engine ref, has /ship pointer
      expect(taskContent).toContain('/ship')
      // ship.md: DEFAULT_TASK_TIERS: XS=3, S=3, Standard=4 in phase map
      expect(shipContent).toMatch(/XS|Standard/)
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
      // ship.md (orchestration) renders tier content; custom Standard=9 visible
      const shipContent = readFileSync(join(dir, '.claude', 'commands', 'ship.md'), 'utf-8')
      expect(shipContent).toMatch(/9/)
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

    it('overwrites .arbiter-backup with current pre-merge state on subsequent runs (#285)', () => {
      const settingsPath = join(dir, '.claude', 'settings.json')
      // First run: seed an initial settings.json
      seedExistingSettingsForBackup(JSON.stringify({ permissions: { allow: ['v1'] } }))
      generateClaude(makeConfig(dir))
      // Mutate settings.json between runs to simulate user edits
      const interim = JSON.stringify({ permissions: { allow: ['v2-user-edit'] } })
      writeFileSync(settingsPath, interim, 'utf-8')
      // Second run: backup must capture the latest pre-merge state, not the first-run snapshot
      generateClaude(makeConfig(dir))
      expect(readFileSync(`${settingsPath}.arbiter-backup`, 'utf-8')).toBe(interim)
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
