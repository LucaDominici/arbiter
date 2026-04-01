import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js';
import { generateClaude } from '../../src/generators/claude.js';
import { getLanguageHooks } from '../../src/detectors/language-hooks.js';

describe('brownfield: settings.json merge', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject('typescript');
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

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
        checkAllSh: false,
      },
    });
  }

  it('merges custom hooks with arbiter hooks', () => {
    const claudeDir = join(dir, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'bash .claude/hooks/my-custom-hook.sh', timeout: 10 },
            ],
          },
        ],
      },
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2));

    const config = configWithExistingSettings();
    generateClaude(config);

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    const hooks = merged['hooks'] as Record<string, unknown[]>;
    const preToolUse = hooks['PreToolUse'] as Array<{ matcher: string; hooks: Array<{ command: string }> }>;

    // Find the Bash matcher
    const bashMatcher = preToolUse.find(entry => entry.matcher === 'Bash');
    expect(bashMatcher).toBeDefined();

    // Should have BOTH the custom hook AND the arbiter hook
    const commands = bashMatcher!.hooks.map(h => h.command);
    expect(commands).toContain('bash .claude/hooks/my-custom-hook.sh');
    expect(commands).toContain('bash .claude/hooks/stop-dangerous.sh');
  });

  it('preserves custom permissions alongside arbiter permissions', () => {
    const claudeDir = join(dir, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const existingSettings = {
      permissions: {
        allow: ['Bash(docker compose *)'],
        deny: ['Bash(rm -rf /*)'],
      },
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2));

    const config = configWithExistingSettings();
    generateClaude(config);

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    const permissions = merged['permissions'] as { allow?: string[]; deny?: string[] };

    // Should have both custom and arbiter permissions
    expect(permissions.allow).toContain('Bash(docker compose *)');
    expect(permissions.allow).toContain('Bash(git *)');
    expect(permissions.allow).toContain('Bash(npm run *)');
  });

  it('does not duplicate hooks when run twice', () => {
    const claudeDir = join(dir, '.claude');
    mkdirSync(claudeDir, { recursive: true });

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
        checkAllSh: false,
      },
    });
    generateClaude(config);

    const firstRun = readFileSync(join(claudeDir, 'settings.json'), 'utf-8');

    // Second run: now settings exist
    const config2 = configWithExistingSettings();
    generateClaude(config2);

    const secondRun = readFileSync(join(claudeDir, 'settings.json'), 'utf-8');

    // Parse both and check no duplicates in Bash hooks
    const first = JSON.parse(firstRun) as Record<string, unknown>;
    const second = JSON.parse(secondRun) as Record<string, unknown>;

    const getHookCommands = (settings: Record<string, unknown>, event: string, matcher: string): string[] => {
      const hooks = settings['hooks'] as Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>>;
      const entry = hooks[event]?.find(e => e.matcher === matcher);
      return entry?.hooks.map(h => h.command) ?? [];
    };

    const firstBashPre = getHookCommands(first, 'PreToolUse', 'Bash');
    const secondBashPre = getHookCommands(second, 'PreToolUse', 'Bash');
    expect(secondBashPre.length).toBe(firstBashPre.length);
  });

  it('preserves unknown top-level keys from existing settings', () => {
    const claudeDir = join(dir, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const existingSettings = {
      customKey: 'custom-value',
      anotherKey: { nested: true },
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2));

    const config = configWithExistingSettings();
    generateClaude(config);

    const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    expect(merged['customKey']).toBe('custom-value');
    expect(merged['anotherKey']).toEqual({ nested: true });
  });
});
