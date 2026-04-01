import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js';
import { runGenerators } from '../../src/commands/init.js';
import { getLanguageHooks } from '../../src/detectors/language-hooks.js';

describe('brownfield: existing AGENTS.md', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject('typescript');
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function configWithExistingAgentsMd() {
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
        agentsMd: true,
        claudeDir: false,
        agentsDir: false,
        aiRulez: false,
        settingsJson: false,
        checkAllSh: false,
      },
    });
  }

  it('backs up existing AGENTS.md before replacing', () => {
    const original = '# ORIGINAL CONTENT\nThis is hand-written governance.';
    writeFileSync(join(dir, 'AGENTS.md'), original);

    const config = configWithExistingAgentsMd();
    runGenerators(config);

    expect(existsSync(join(dir, 'AGENTS.md.arbiter-backup'))).toBe(true);
    const backup = readFileSync(join(dir, 'AGENTS.md.arbiter-backup'), 'utf-8');
    expect(backup).toBe(original);
  });

  it('replaces AGENTS.md with arbiter-generated content', () => {
    const original = '# ORIGINAL CONTENT\nThis is hand-written governance.';
    writeFileSync(join(dir, 'AGENTS.md'), original);

    const config = configWithExistingAgentsMd();
    runGenerators(config);

    const newContent = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(newContent).not.toContain('ORIGINAL CONTENT');
    expect(newContent).toContain('AGENTS.md');
    expect(newContent).toContain('Invariants');
  });

  it('returns backed-up-and-replaced action for AGENTS.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# old');

    const config = configWithExistingAgentsMd();
    const results = runGenerators(config);

    const agentsResult = results.find(r => r.path.endsWith('AGENTS.md'));
    expect(agentsResult).toBeDefined();
    expect(agentsResult!.action).toBe('backed-up-and-replaced');
  });

  it('second run backs up the previously generated content', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# first version');

    const config = configWithExistingAgentsMd();
    runGenerators(config);

    const firstGenerated = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');

    // Second run should back up the first generated version
    runGenerators(config);

    const backup = readFileSync(join(dir, 'AGENTS.md.arbiter-backup'), 'utf-8');
    expect(backup).toBe(firstGenerated);
  });
});
