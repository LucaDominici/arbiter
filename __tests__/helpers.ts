import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Language } from '../src/wizard/types.js';

/**
 * Create a temp directory with language-specific marker files.
 */
export function createTestProject(language: Language = 'unknown'): string {
  const dir = mkdtempSync(join(tmpdir(), `arbiter-test-${language}-`));

  switch (language) {
    case 'typescript':
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
        devDependencies: { typescript: '^5.0.0', eslint: '^9.0.0', prettier: '^3.0.0' },
      }));
      break;
    case 'java':
      writeFileSync(join(dir, 'build.gradle'), 'plugins { id "java" }');
      break;
    case 'rust':
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "test"\nversion = "0.1.0"');
      break;
    case 'go':
      writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.22');
      break;
    case 'python':
      writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "test"');
      break;
  }

  return dir;
}

/**
 * Initialize a git repo in the given directory.
 */
export function initGit(dir: string, remote?: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' });
  if (remote) {
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir, stdio: 'ignore' });
  }
}

/**
 * Remove a test project directory.
 */
export function cleanupTestProject(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
