import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js';
import { runGenerators } from '../../src/commands/init.js';
import { getLanguageHooks } from '../../src/detectors/language-hooks.js';

describe('matrix: Java project', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject('java');
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function javaConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: 'java',
      framework: 'spring-boot',
      buildTool: 'gradle',
      buildCommand: 'gradle build -x test',
      testCommand: 'gradle test',
      lintCommand: 'gradle checkstyleMain',
      formatCommand: 'echo "no formatter configured"',
      tools: ['claude', 'codex'],
      useGitHub: true,
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      languageHooks: getLanguageHooks('java'),
      ...overrides,
    });
  }

  it('generates AGENTS.md mentioning Java', () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('java');
  });

  it('AGENTS.md mentions spring-boot framework', () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('spring-boot');
  });

  it('AGENTS.md includes hexagonal architecture invariant', () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('Hexagonal architecture');
    expect(content).toContain('domain must not import from adapters');
  });

  it('CI workflow uses gradle commands', () => {
    const config = javaConfig();
    runGenerators(config);
    const ci = readFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ci).toContain('gradlew checkstyleMain');
    expect(ci).toContain('gradlew test');
    expect(ci).toContain('setup-java');
  });

  it('check-all.sh references gradlew', () => {
    const config = javaConfig();
    runGenerators(config);
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.sh'), 'utf-8');
    expect(checkAll).toContain('gradlew');
    expect(checkAll).toContain('checkstyleMain');
  });

  it('does not include TypeScript-specific hooks', () => {
    const config = javaConfig();
    runGenerators(config);
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-any.sh'))).toBe(false);
  });

  it('AGENTS.md coding standards are Java-specific', () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('constructor injection');
    expect(content).toContain('Records for immutable data transfer');
    // Should NOT contain TypeScript standards
    expect(content).not.toContain('Strict mode always on');
    expect(content).not.toContain('.unwrap()');
  });

  it('settings.json includes gradle permissions', () => {
    const config = javaConfig();
    runGenerators(config);
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')) as Record<string, unknown>;
    const permissions = settings['permissions'] as { allow?: string[] };
    expect(permissions.allow).toEqual(expect.arrayContaining(['Bash(./gradlew *)']));
    // Should NOT contain npm permissions
    expect(permissions.allow).not.toEqual(expect.arrayContaining(['Bash(npm run *)']));
  });
});
