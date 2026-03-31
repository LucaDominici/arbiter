import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInit } from '../../src/commands/init.js';
import { runUpdate } from '../../src/commands/update.js';
import { runDiff } from '../../src/commands/diff.js';
import { loadConfig } from '../../src/utils/config.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-update-test-'));
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
}

describe('arbiter update', () => {
  let dir: string;

  beforeEach(async () => {
    dir = tmpDir();
    initGit(dir);
    await runInit({ yes: true, tools: 'claude,codex', level: 'L2', dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves arbiter.json during init', () => {
    const config = loadConfig(dir);
    expect(config).not.toBeNull();
    expect(config!.tools).toEqual(['claude', 'codex']);
    expect(config!.governanceLevel).toBe('L2');
  });

  it('update re-generates AGENTS.md', async () => {
    const agentsPath = join(dir, 'AGENTS.md');
    const before = readFileSync(agentsPath, 'utf-8');

    await runUpdate({ dir, github: false });

    const after = readFileSync(agentsPath, 'utf-8');
    // Content should be the same (same config)
    expect(after).toBe(before);
    // Backup should exist (always backs up on update)
    expect(existsSync(agentsPath + '.arbiter-backup')).toBe(true);
  });

  it('update preserves existing hooks', async () => {
    const hookPath = join(dir, '.claude', 'hooks', 'stop-dangerous.sh');
    const original = readFileSync(hookPath, 'utf-8');

    // Modify the hook to simulate customization
    writeFileSync(hookPath, original + '\n# Custom modification', 'utf-8');

    await runUpdate({ dir, github: false });

    const after = readFileSync(hookPath, 'utf-8');
    expect(after).toContain('# Custom modification');
  });

  it('update works with cursor+copilot tools', async () => {
    // Re-init with all tools
    await runInit({ yes: true, tools: 'claude,codex,cursor,copilot', level: 'L2', dir });
    await runUpdate({ dir, github: false });

    expect(existsSync(join(dir, '.cursorrules'))).toBe(true);
    expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(true);
  });
});

describe('arbiter diff', () => {
  let dir: string;
  let consoleSpy: ReturnType<typeof import('vitest')['vi']['spyOn']>;

  beforeEach(async () => {
    dir = tmpDir();
    initGit(dir);
    await runInit({ yes: true, tools: 'claude,codex', level: 'L2', dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('shows = for unchanged files', () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(' '));

    try {
      runDiff({ dir });
    } finally {
      console.log = originalLog;
    }

    const unchangedLines = output.filter(l => l.includes('(unchanged)'));
    expect(unchangedLines.length).toBeGreaterThan(0);
  });

  it('shows ~ when content differs', () => {
    // Modify AGENTS.md to create a diff
    const agentsPath = join(dir, 'AGENTS.md');
    writeFileSync(agentsPath, 'Modified content\n', 'utf-8');

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(' '));

    try {
      runDiff({ dir });
    } finally {
      console.log = originalLog;
    }

    const updateLines = output.filter(l => l.includes('(would update)'));
    expect(updateLines.length).toBeGreaterThan(0);
  });

  it('exits with error when no arbiter.json', () => {
    const freshDir = tmpDir();
    initGit(freshDir);

    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => { exitCode = code; throw new Error('exit'); }) as never;

    try {
      runDiff({ dir: freshDir });
    } catch {
      // Expected — our mock throws to halt execution
    } finally {
      process.exit = originalExit;
      rmSync(freshDir, { recursive: true, force: true });
    }

    expect(exitCode).toBe(1);
  });
});

describe('ai-rulez detection', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    initGit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips tool-specific configs when .ai-rulez/ exists', async () => {
    // Create .ai-rulez directory before init
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, '.ai-rulez'), { recursive: true });

    await runInit({ yes: true, tools: 'claude,codex', level: 'L2', dir });

    // AGENTS.md should still be generated
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);

    // Tool-specific configs should NOT be generated
    expect(existsSync(join(dir, '.claude', 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(dir, '.agents', 'CODEX.md'))).toBe(false);
  });
});
