import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateClaude } from '../../src/generators/claude.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'
import { mergeSettingsJson } from '../../src/utils/fs.js'
import { getLogger } from '../../src/utils/logger.js'

describe('brownfield: settings.json merge', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function configWithExistingSettings() {
    return makeConfig(dir, {
      language: 'typescript',
      buildTool: 'npm',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      formatCommand: 'npx prettier --check .',
      tools: ['claude'],
      useGitHub: false,
      languageHooks: getLanguageHooks('typescript'),
      existing: {
        agentsMd: false,
        claudeDir: true,
        agentsDir: false,
        aiRulez: false,
        settingsJson: true,
        checkAllScript: false,
      },
    })
  }

  it('preserves an existing customized dispatcher command during the dispatcher upgrade', () => {
    const existingDispatcher =
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/hooks.mjs" \'PreToolUse:Edit|Write\''
    const incomingDispatcher = "node .claude/hooks/hooks.mjs 'PreToolUse:Edit|Write'"
    const warnSpy = vi.spyOn(getLogger(), 'warn').mockImplementation(() => {})

    try {
      const result = mergeSettingsJson(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [
                  { type: 'command', command: existingDispatcher, timeout: 30 },
                  { type: 'command', command: 'node .claude/hooks/stop-dangerous.mjs' },
                  { type: 'command', command: 'bash .claude/hooks/my-custom-hook.sh' },
                ],
              },
            ],
          },
        },
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [{ type: 'command', command: incomingDispatcher, timeout: 10 }],
              },
            ],
          },
        },
      ) as {
        hooks: Record<
          string,
          Array<{
            matcher: string
            hooks: Array<{ type: string; command: string; timeout?: number }>
          }>
        >
      }

      const hooks = result.hooks.PreToolUse?.[0]?.hooks ?? []
      expect(hooks).toEqual([
        { type: 'command', command: existingDispatcher, timeout: 30 },
        { type: 'command', command: 'bash .claude/hooks/my-custom-hook.sh' },
      ])
      expect(warnSpy).toHaveBeenCalledWith(
        'fs.hook_command_preserved',
        {
          hook_event: 'PreToolUse',
          matcher: 'Edit|Write',
          existing_command: existingDispatcher,
          incoming_command: incomingDispatcher,
        },
        expect.any(String),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('merges custom hooks with arbiter hooks', () => {
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'bash .claude/hooks/my-custom-hook.sh',
                timeout: 10,
              },
            ],
          },
        ],
      },
    }
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2))

    const config = configWithExistingSettings()
    generateClaude(config)

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    const hooks = merged['hooks'] as Record<string, unknown[]>
    const preToolUse = hooks['PreToolUse'] as Array<{
      matcher: string
      hooks: Array<{ command: string }>
    }>

    // Find the Bash matcher
    const bashMatcher = preToolUse.find((entry) => entry.matcher === 'Bash')
    expect(bashMatcher).toBeDefined()

    // Should have BOTH the custom hook AND the arbiter dispatcher (#248)
    const commands = bashMatcher!.hooks.map((h) => h.command)
    expect(commands).toContain('bash .claude/hooks/my-custom-hook.sh')
    expect(commands.some((c) => c.includes('hooks.mjs'))).toBe(true)
  })

  it('preserves custom permissions alongside arbiter permissions', () => {
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const existingSettings = {
      permissions: {
        allow: ['Bash(docker compose *)'],
        deny: ['Bash(rm -rf /*)'],
      },
    }
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2))

    const config = configWithExistingSettings()
    generateClaude(config)

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    const permissions = merged['permissions'] as {
      allow?: string[]
      deny?: string[]
    }

    // Should have both custom and arbiter permissions
    expect(permissions.allow).toContain('Bash(docker compose *)')
    expect(permissions.allow).toContain('Bash(git *)')
    expect(permissions.allow).toContain('Bash(npm run *)')
  })

  it('does not duplicate hooks when run twice', () => {
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    // First run: create settings from scratch
    const config = makeConfig(dir, {
      language: 'typescript',
      buildTool: 'npm',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      formatCommand: 'npx prettier --check .',
      tools: ['claude'],
      useGitHub: false,
      languageHooks: getLanguageHooks('typescript'),
      existing: {
        agentsMd: false,
        claudeDir: false,
        agentsDir: false,
        aiRulez: false,
        settingsJson: false,
        checkAllScript: false,
      },
    })
    generateClaude(config)

    const firstRun = readFileSync(join(claudeDir, 'settings.json'), 'utf-8')

    // Second run: now settings exist
    const config2 = configWithExistingSettings()
    generateClaude(config2)

    const secondRun = readFileSync(join(claudeDir, 'settings.json'), 'utf-8')

    // Parse both and check no duplicates in Bash hooks
    const first = JSON.parse(firstRun) as Record<string, unknown>
    const second = JSON.parse(secondRun) as Record<string, unknown>

    const getHookCommands = (
      settings: Record<string, unknown>,
      event: string,
      matcher: string,
    ): string[] => {
      const hooks = settings['hooks'] as Record<
        string,
        Array<{ matcher: string; hooks: Array<{ command: string }> }>
      >
      const entry = hooks[event]?.find((e) => e.matcher === matcher)
      return entry?.hooks.map((h) => h.command) ?? []
    }

    const firstBashPre = getHookCommands(first, 'PreToolUse', 'Bash')
    const secondBashPre = getHookCommands(second, 'PreToolUse', 'Bash')
    expect(secondBashPre.length).toBe(firstBashPre.length)
  })

  it('replaces old .sh hook commands with new .mjs equivalents during merge', () => {
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'bash .claude/hooks/stop-dangerous.sh',
                timeout: 10,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [
              {
                type: 'command',
                command: 'bash .claude/hooks/check-no-orphan-todo.sh',
                timeout: 10,
              },
              {
                type: 'command',
                command: 'bash .claude/hooks/check-no-any.sh',
                timeout: 10,
              },
            ],
          },
        ],
      },
    }
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2))

    const config = configWithExistingSettings()
    generateClaude(config)

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    const hooks = merged['hooks'] as Record<string, unknown[]>

    // Check PreToolUse Bash matcher
    const preToolUse = hooks['PreToolUse'] as Array<{
      matcher: string
      hooks: Array<{ command: string }>
    }>
    const bashMatcher = preToolUse.find((e) => e.matcher === 'Bash')
    const bashCommands = bashMatcher!.hooks.map((h) => h.command)

    // Should have dispatcher, NOT old .sh (#248)
    expect(bashCommands.some((c) => c.includes('hooks.mjs'))).toBe(true)
    expect(bashCommands).not.toContain('bash .claude/hooks/stop-dangerous.sh')

    // Check PostToolUse Edit|Write matcher
    const postToolUse = hooks['PostToolUse'] as Array<{
      matcher: string
      hooks: Array<{ command: string }>
    }>
    const editMatcher = postToolUse.find((e) => e.matcher === 'Edit|Write')
    const editCommands = editMatcher!.hooks.map((h) => h.command)

    // Dispatcher replaces arbiter-managed hook commands (#248)
    expect(editCommands.some((c) => c.includes('hooks.mjs'))).toBe(true)
    // Known arbiter hooks removed from explicit entries (now handled by dispatcher)
    expect(editCommands).not.toContain('bash .claude/hooks/check-no-orphan-todo.sh')
    // Non-arbiter language hooks preserved alongside dispatcher (brownfield behaviour)
    // check-no-any.sh is a project-specific hook, not in ARBITER_HOOK_BASENAMES
  })

  it('replaces cd-prefixed .sh hooks with .mjs equivalents', () => {
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command:
                  'cd "$(git rev-parse --show-toplevel)" && bash .claude/hooks/stop-dangerous.sh',
                timeout: 10,
              },
            ],
          },
        ],
      },
    }
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2))

    const config = configWithExistingSettings()
    generateClaude(config)

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    const hooks = merged['hooks'] as Record<string, unknown[]>
    const preToolUse = hooks['PreToolUse'] as Array<{
      matcher: string
      hooks: Array<{ command: string }>
    }>
    const bashMatcher = preToolUse.find((e) => e.matcher === 'Bash')
    const bashCommands = bashMatcher!.hooks.map((h) => h.command)

    // Should have dispatcher, NOT the cd-prefixed .sh (#248)
    expect(bashCommands.some((c) => c.includes('hooks.mjs'))).toBe(true)
    expect(bashCommands).not.toContain(
      'cd "$(git rev-parse --show-toplevel)" && bash .claude/hooks/stop-dangerous.sh',
    )
  })

  it('preserves truly custom hooks that are not arbiter-managed', () => {
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'bash .claude/hooks/my-team-policy.sh',
                timeout: 10,
              },
              {
                type: 'command',
                command: 'bash .claude/hooks/stop-dangerous.sh',
                timeout: 10,
              },
            ],
          },
        ],
      },
    }
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2))

    const config = configWithExistingSettings()
    generateClaude(config)

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    const hooks = merged['hooks'] as Record<string, unknown[]>
    const preToolUse = hooks['PreToolUse'] as Array<{
      matcher: string
      hooks: Array<{ command: string }>
    }>
    const bashMatcher = preToolUse.find((e) => e.matcher === 'Bash')
    const bashCommands = bashMatcher!.hooks.map((h) => h.command)

    // Custom hook preserved
    expect(bashCommands).toContain('bash .claude/hooks/my-team-policy.sh')
    // Arbiter dispatcher present (#248)
    expect(bashCommands.some((c) => c.includes('hooks.mjs'))).toBe(true)
    expect(bashCommands).not.toContain('bash .claude/hooks/stop-dangerous.sh')
  })

  it('preserves unknown top-level keys from existing settings', () => {
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const existingSettings = {
      customKey: 'custom-value',
      anotherKey: { nested: true },
    }
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2))

    const config = configWithExistingSettings()
    generateClaude(config)

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(merged['customKey']).toBe('custom-value')
    expect(merged['anotherKey']).toEqual({ nested: true })
  })
})
