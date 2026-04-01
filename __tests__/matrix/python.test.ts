import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js';
import { runGenerators } from '../../src/commands/init.js';
import { getLanguageHooks } from '../../src/detectors/language-hooks.js';

describe('matrix: Python project', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject('python');
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function pythonConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: 'python',
      framework: null,
      buildTool: 'pip',
      buildCommand: 'pip install -e .',
      testCommand: 'pytest',
      lintCommand: 'ruff check .',
      formatCommand: 'ruff format --check .',
      tools: ['claude', 'codex'],
      useGitHub: true,
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      languageHooks: getLanguageHooks('python'),
      ...overrides,
    });
  }

  it('generates AGENTS.md mentioning Python', () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('python');
  });

  it('AGENTS.md gate system references pytest and ruff commands', () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('pytest');
    expect(content).toContain('ruff check');
    expect(content).toContain('ruff format');
  });

  it('AGENTS.md does not contain TypeScript/Rust/Java-specific invariants', () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).not.toContain('No `any` type');
    expect(content).not.toContain('.unwrap()');
    expect(content).not.toContain('Hexagonal architecture');
  });

  it('generates all standard files', () => {
    const config = pythonConfig();
    const results = runGenerators(config);
    const paths = results.map(r => r.path);
    expect(paths.some(p => p.endsWith('AGENTS.md'))).toBe(true);
    expect(paths.some(p => p.includes('.claude/CLAUDE.md'))).toBe(true);
    expect(paths.some(p => p.includes('.agents/CODEX.md'))).toBe(true);
    expect(paths.some(p => p.includes('.github/workflows/ci.yml'))).toBe(true);
  });

  it('settings.json does not include npm or gradle permissions', () => {
    const config = pythonConfig();
    runGenerators(config);
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')) as Record<string, unknown>;
    const permissions = settings['permissions'] as { allow?: string[] };
    expect(permissions.allow).not.toEqual(expect.arrayContaining(['Bash(npm run *)']));
    expect(permissions.allow).not.toEqual(expect.arrayContaining(['Bash(./gradlew *)']));
    expect(permissions.allow).not.toEqual(expect.arrayContaining(['Bash(cargo *)']));
  });
});
