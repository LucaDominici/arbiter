// #2045: one-shot file bypass + logged env-var bypass + config-driven guarded paths.
// The hook is spawned from its REAL path in the repo (not copied into a temp fixture) so
// its `./lib.mjs` import resolves normally; only `cwd` points at an isolated temp git repo
// with its own `arbiter.json`, which is how getRepoRoot() and the config read pick up
// per-test fixture state (mirrors __tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts).
// This also decouples the tests from arbiter's OWN real arbiter.json — the previous version
// of this file spawned the hook with cwd = the real arbiter repo, which broke the moment the
// guarded-path list became config-driven (arbiter's own governance.ssotGuardPatterns no
// longer matches the generic default `docs/SYSTEM/...` paths, see .dogfood-divergences.json).
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

const HOOK_PATH = resolve(import.meta.dirname, '../../../.claude/hooks/pre-edit-ssot-guard.mjs')
const BYPASS_LOG_PATH = (dir: string) => join(dir, '.arbiter', 'evidence', 'bypass-log.jsonl')
const BYPASS_FILE_PATH = (dir: string) => join(dir, '.arbiter', 'ssot-bypass')

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-ssot-guard-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function writeArbiterConfig(dir: string, governance: Record<string, unknown>): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ version: '0.2', governance }, null, 2))
}

function writeBypassFile(dir: string, reason: string): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(BYPASS_FILE_PATH(dir), reason)
}

function readBypassLog(dir: string): Array<Record<string, unknown>> {
  const path = BYPASS_LOG_PATH(dir)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function runHook(dir: string, filePath: string, env: NodeJS.ProcessEnv = {}) {
  const baseEnv = { ...process.env }
  delete baseEnv['ARBITER_SSOT_BYPASS']
  return spawnSync('node', [HOOK_PATH], {
    cwd: dir,
    encoding: 'utf-8',
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } }),
    env: { ...baseEnv, ...env },
  })
}

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('pre-edit-ssot-guard', () => {
  describe('default (no arbiter.json) guarded-path behavior', () => {
    it('exits 2 when editing AGENTS.md', () => {
      const dir = track(setup())
      const result = runHook(dir, 'AGENTS.md')
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('SSOT GUARD')
    })

    it('exits 2 when editing .claude/CLAUDE.md', () => {
      const dir = track(setup())
      expect(runHook(dir, '.claude/CLAUDE.md').status).toBe(2)
    })

    it('exits 2 when editing docs/SYSTEM/DECISIONS.md', () => {
      const dir = track(setup())
      expect(runHook(dir, 'docs/SYSTEM/DECISIONS.md').status).toBe(2)
    })

    it('exits 0 for non-SSOT files', () => {
      const dir = track(setup())
      expect(runHook(dir, 'src/commands/init.ts').status).toBe(0)
    })

    it('exits 0 for a guarded basename outside the repo root (#173 repoRoot anchor)', () => {
      const dir = track(setup())
      const result = runHook(dir, '/tmp/other-project/AGENTS.md')
      expect(result.status).toBe(0)
    })

    it('exits 2 for an absolute path to AGENTS.md inside the repo root (#173)', () => {
      const dir = track(setup())
      const result = runHook(dir, join(dir, 'AGENTS.md'))
      expect(result.status).toBe(2)
    })
  })

  describe('ARBITER_SSOT_BYPASS env-var bypass (#2045: now logged, parity with pre-edit-plan-anchor)', () => {
    it('exits 0 on a guarded file and appends a BYPASS event to bypass-log.jsonl', () => {
      const dir = track(setup())
      const result = runHook(dir, 'AGENTS.md', { ARBITER_SSOT_BYPASS: '1' })
      expect(result.status).toBe(0)
      const log = readBypassLog(dir)
      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({
        env: 'ARBITER_SSOT_BYPASS',
        value: '1',
        bypassed: true,
        gate: 'pre-edit-ssot-guard',
      })
    })
  })

  describe('one-shot file bypass at .arbiter/ssot-bypass (#2045)', () => {
    it('allows a guarded edit once, consumes the file, and logs BYPASS with the reason', () => {
      const dir = track(setup())
      writeBypassFile(dir, 'ADR-999 emergency correction')

      const first = runHook(dir, 'AGENTS.md')
      expect(first.status).toBe(0)
      expect(existsSync(BYPASS_FILE_PATH(dir))).toBe(false)

      const log = readBypassLog(dir)
      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({
        gate: 'pre-edit-ssot-guard',
        bypassed: true,
        reason: 'ADR-999 emergency correction',
      })

      // Second attempt without recreating the file — blocked again.
      const second = runHook(dir, 'AGENTS.md')
      expect(second.status).toBe(2)
      expect(readBypassLog(dir)).toHaveLength(1) // no new entry
    })

    it('consumes the file but still blocks when the reason is empty', () => {
      const dir = track(setup())
      writeBypassFile(dir, '')

      const result = runHook(dir, 'AGENTS.md')
      expect(result.status).toBe(2)
      expect(existsSync(BYPASS_FILE_PATH(dir))).toBe(false)
      expect(readBypassLog(dir)).toHaveLength(0)
    })

    it('is not consumed by an edit to a non-guarded file', () => {
      const dir = track(setup())
      writeBypassFile(dir, 'reason')

      const nonGuarded = runHook(dir, 'src/index.ts')
      expect(nonGuarded.status).toBe(0)
      expect(existsSync(BYPASS_FILE_PATH(dir))).toBe(true)

      const guarded = runHook(dir, 'AGENTS.md')
      expect(guarded.status).toBe(0)
      expect(existsSync(BYPASS_FILE_PATH(dir))).toBe(false)
    })
  })

  describe('config-driven guarded paths (arbiter.json governance.ssotGuardPatterns, #2045)', () => {
    it('protects a custom path not in the built-in default list', () => {
      const dir = track(setup())
      writeArbiterConfig(dir, { ssotGuardPatterns: ['custom/PROTECTED.md'] })

      expect(runHook(dir, 'custom/PROTECTED.md').status).toBe(2)
    })

    it('adds to (never replaces) the default list — a default-guarded path stays guarded once configured', () => {
      const dir = track(setup())
      writeArbiterConfig(dir, { ssotGuardPatterns: ['custom/PROTECTED.md'] })

      expect(runHook(dir, 'AGENTS.md').status).toBe(2)
    })

    it('ignores a malformed ssotGuardPatterns value and falls back to the defaults', () => {
      const dir = track(setup())
      writeArbiterConfig(dir, { ssotGuardPatterns: 'not-an-array' })

      expect(runHook(dir, 'AGENTS.md').status).toBe(2)
      expect(runHook(dir, 'custom/PROTECTED.md').status).toBe(0)
    })

    it('falls back to the built-in defaults when arbiter.json has no ssotGuardPatterns key', () => {
      const dir = track(setup())
      writeArbiterConfig(dir, {})

      expect(runHook(dir, 'AGENTS.md').status).toBe(2)
    })

    it('falls back to the built-in defaults when arbiter.json is missing entirely', () => {
      const dir = track(setup())
      expect(runHook(dir, 'AGENTS.md').status).toBe(2)
    })
  })
})
