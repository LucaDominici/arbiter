// #2403: post-subagent-release.mjs is the SubagentStop cleanup companion to
// pre-spawn-worktree-guard.mjs — it removes the finished dispatch's
// `.arbiter/agents-active.json` sidecar entry so a normally-completed write-intent
// agent does not wedge the next spawn for the full 2h TTL. Spawned from its REAL path
// in the repo (not copied into a temp fixture) so its `./lib.mjs` import resolves
// normally — mirrors __tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

const HOOK_PATH = resolve(import.meta.dirname, '../../../.claude/hooks/post-subagent-release.mjs')

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-subagent-release-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function writeSidecar(dir: string, entries: unknown[]): void {
  const arbiterDir = join(dir, '.arbiter')
  mkdirSync(arbiterDir, { recursive: true })
  writeFileSync(join(arbiterDir, 'agents-active.json'), JSON.stringify(entries, null, 2) + '\n')
}

function readSidecar(dir: string): Array<{ agent: string; ts: number; cwd: string }> {
  return JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
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

describe('post-subagent-release hook (SubagentStop, #2403)', () => {
  it('exits 0 and removes the oldest entry matching agent+cwd', () => {
    const dir = track(setup())
    const older = Date.now() - 1000
    const newer = Date.now()
    writeSidecar(dir, [
      { agent: 'general-purpose', ts: older, pid: 1, cwd: dir },
      { agent: 'general-purpose', ts: newer, pid: 2, cwd: dir },
    ])
    const result = runHook(dir, { agent: 'general-purpose', cwd: dir })
    expect(result.status).toBe(0)
    const sidecar = readSidecar(dir)
    expect(sidecar.length).toBe(1)
    expect(sidecar[0].ts).toBe(newer) // the OLDEST entry was removed
  })

  it('exits 0 and leaves a non-matching-cwd entry untouched', () => {
    const dir = track(setup())
    writeSidecar(dir, [
      { agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: '/somewhere/else' },
    ])
    const result = runHook(dir, { agent: 'general-purpose', cwd: dir })
    expect(result.status).toBe(0)
    expect(readSidecar(dir).length).toBe(1)
  })

  it('exits 0 and prunes only stale entries when no cwd is present on the payload', () => {
    const dir = track(setup())
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: dir }])
    const result = runHook(dir, {})
    expect(result.status).toBe(0)
    expect(readSidecar(dir).length).toBe(1) // fresh entry, no cwd to correlate — untouched
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

  it('exits 0 and drops a TTL-stale entry even without a cwd match', () => {
    const dir = track(setup())
    const staleTs = Date.now() - 3 * 60 * 60 * 1000 // 3h ago > 2h TTL
    writeSidecar(dir, [{ agent: 'general-purpose', ts: staleTs, pid: 1, cwd: '/somewhere/else' }])
    const result = runHook(dir, { agent: 'general-purpose', cwd: dir })
    expect(result.status).toBe(0)
    expect(readSidecar(dir).length).toBe(0)
  })
})
