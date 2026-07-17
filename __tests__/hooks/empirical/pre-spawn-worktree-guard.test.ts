// E5 (#1947): spawn-time worktree guard. IMPLEMENT-BUT-NOT-ACTIVATED (OD-14) —
// this hook is not wired in .claude/settings.json; these are empirical exit-code
// tests run by spawning the hook file directly, per design doc §E5 red-path.
//
// The hook is spawned from its REAL path in the repo (not copied into the temp
// fixture) so its `./lib.mjs` import resolves normally; only `cwd` points at the
// temp git repo, which is how getRepoRoot() and the sidecar/write-classes reads
// pick up the fixture state (mirrors __tests__/hooks/enforce-gate-before-pr-worktree.test.ts).
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

const HOOK_PATH = resolve(import.meta.dirname, '../../../.claude/hooks/pre-spawn-worktree-guard.mjs')

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-spawn-guard-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function writeWriteClasses(dir: string, classes: Record<string, string>): void {
  const agentsDir = join(dir, '.claude', 'agents')
  mkdirSync(agentsDir, { recursive: true })
  writeFileSync(
    join(agentsDir, 'agent-write-classes.json'),
    JSON.stringify({ $schemaVersion: 1, classes }, null, 2) + '\n',
  )
}

function writeSidecar(dir: string, entries: unknown[]): void {
  const arbiterDir = join(dir, '.arbiter')
  mkdirSync(arbiterDir, { recursive: true })
  writeFileSync(join(arbiterDir, 'agents-active.json'), JSON.stringify(entries, null, 2) + '\n')
}

function runHook(dir: string, payload: Record<string, unknown>): ReturnType<typeof spawnSync> {
  return spawnSync('node', [HOOK_PATH], {
    cwd: dir,
    encoding: 'utf-8',
    input: JSON.stringify(payload),
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

describe('pre-spawn-worktree-guard hook (#1947, design doc §E5)', () => {
  it('exits 2: unknown agent type + no isolation + a live writer already registered', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: dir }])
    const result = runHook(dir, {
      tool_input: { subagent_type: 'unknown-type', prompt: 'do a thing for #100' },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('SPAWN GUARD')
  })

  it('exits 0: codebase-scanner dispatch under the same live-writer sidecar', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: dir }])
    const result = runHook(dir, {
      tool_input: { subagent_type: 'codebase-scanner', prompt: 'scan for #100' },
    })
    expect(result.status).toBe(0)
  })

  it('exits 0 and grows the sidecar: isolation:"worktree" write dispatch', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: dir }])
    const result = runHook(dir, {
      tool_input: { subagent_type: 'general-purpose', isolation: 'worktree', prompt: 'work on #100' },
    })
    expect(result.status).toBe(0)
    const sidecar = JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
    expect(sidecar.length).toBe(2)
  })

  it('exits 2: prompt referencing more than one distinct task id (M2)', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const result = runHook(dir, {
      tool_input: {
        subagent_type: 'general-purpose',
        isolation: 'worktree',
        prompt: 'work on #12 and also #34',
      },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('one-task-per-dispatch')
  })

  it('exits 0: no live writer on the main tree, single write-intent spawn allowed and registered', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const result = runHook(dir, {
      tool_input: { subagent_type: 'general-purpose', prompt: 'work on #100' },
    })
    expect(result.status).toBe(0)
    const sidecar = JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
    expect(sidecar.length).toBe(1)
  })

  it('exits 0: unreadable/empty stdin stands down (FAIL-OPEN-INTENT)', () => {
    const dir = track(setup())
    const result = spawnSync('node', [HOOK_PATH], {
      cwd: dir,
      encoding: 'utf-8',
      input: 'not json',
    })
    expect(result.status).toBe(0)
  })
})
