import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig, loadConfig, defaultConfig } from '../../src/utils/config.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-config-test-'));
}

describe('arbiter config', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saveConfig creates arbiter.json', () => {
    saveConfig(dir, defaultConfig());
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true);
  });

  it('loadConfig returns null when no file exists', () => {
    expect(loadConfig(dir)).toBeNull();
  });

  it('saveConfig + loadConfig round-trips correctly', () => {
    const config = { version: '0.1', tools: ['claude', 'codex'] as const, governanceLevel: 'L2' as const, useGitHub: true };
    saveConfig(dir, config);
    const loaded = loadConfig(dir);
    expect(loaded).toEqual(config);
  });

  it('defaultConfig returns L2 with claude+codex', () => {
    const config = defaultConfig();
    expect(config.governanceLevel).toBe('L2');
    expect(config.tools).toEqual(['claude', 'codex']);
    expect(config.useGitHub).toBe(false);
  });

  it('loadConfig returns null on malformed JSON', () => {
    const path = join(dir, 'arbiter.json');
    writeFileSync(path, '{invalid json', 'utf-8');
    expect(loadConfig(dir)).toBeNull();
  });

  it('saveConfig preserves all tool types', () => {
    const config = { version: '0.1', tools: ['claude', 'codex', 'cursor', 'copilot'] as const, governanceLevel: 'L3' as const, useGitHub: false };
    saveConfig(dir, config);
    const loaded = loadConfig(dir);
    expect(loaded!.tools).toEqual(['claude', 'codex', 'cursor', 'copilot']);
    expect(loaded!.governanceLevel).toBe('L3');
  });
});
