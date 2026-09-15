// E5 (#1947): spawn-time worktree guard. Activated advisory per OD-14
// (2026-07-17) — wired in .claude/settings.json's PreToolUse matchers
// (Task|Agent) at soft/advisory grading by default; ARBITER_SPAWN_GUARD_HARD=1
// promotes to hard (exit 2), mirroring stop-finding-loss.mjs (E6b #1948).
// These are empirical exit-code tests run by spawning the hook file directly,
// per design doc §E5 red-path.
//
// The hook is spawned from its REAL path in the repo (not copied into the temp
// fixture) so its `./lib.mjs` import resolves normally; only `cwd` points at the
// temp git repo, which is how getRepoRoot() and the sidecar/write-classes reads
// pick up the fixture state (mirrors __tests__/hooks/enforce-gate-before-pr-worktree.test.ts).
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

const HOOK_PATH = resolve(
  import.meta.dirname,
  '../../../.claude/hooks/pre-spawn-worktree-guard.mjs',
)

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

function bindHost(dir: string, sessionId = 'bound-session') {
  const home = join(dir, 'home')
  const transcript = join(
    home,
    '.claude',
    'projects',
    dir.replace(/[^A-Za-z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  )
  mkdirSync(join(transcript, '..'), { recursive: true })
  writeFileSync(transcript, '{}\n')
  mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
  writeFileSync(
    join(dir, '.claude', '.task', 'status.json'),
    JSON.stringify({
      taskId: '#100',
      hostBinding: { worktreePath: dir, branch: 'main', sessionId, transcriptPath: transcript },
    }),
  )
  return { home, transcript, sessionId }
}

function runHook(
  dir: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> {
  return spawnSync('node', [HOOK_PATH], {
    cwd: dir,
    encoding: 'utf-8',
    input: JSON.stringify(payload),
    // Arbiter's own .claude/settings.json exports ARBITER_SPAWN_GUARD_HARD=1 (hard
    // grading repo-wide) — blank it so the default-grading tests test the code
    // default, not the ambient session env; hard tests still opt in explicitly.
    // CLAUDE_PID is blanked for the same reason (#2588): a test run inside a Claude Code
    // session would otherwise register that session's pid, and CI would register none.
    env: { ...process.env, ARBITER_SPAWN_GUARD_HARD: '', CLAUDE_PID: '', ...env },
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
  it('#2685 blocks even a read-only dispatch when the native session is not the bound worktree', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const bound = bindHost(dir)
    const result = runHook(
      dir,
      {
        cwd: join(dir, '..'),
        session_id: bound.sessionId,
        transcript_path: bound.transcript,
        tool_input: { subagent_type: 'codebase-scanner', prompt: 'scan #100' },
      },
      { ARBITER_SPAWN_GUARD_HARD: '1', HOME: bound.home },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/native host root|outside the current repository/i)
  })

  it('#2685 allows the bound worktree session before the read-only fast path', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const bound = bindHost(dir)
    const result = runHook(
      dir,
      {
        cwd: dir,
        session_id: bound.sessionId,
        transcript_path: bound.transcript,
        tool_input: { subagent_type: 'codebase-scanner', prompt: 'scan #100' },
      },
      { ARBITER_SPAWN_GUARD_HARD: '1', HOME: bound.home },
    )
    expect(result.status).toBe(0)
  })

  it('exits 2: unknown agent type + no isolation + a live writer already registered, hard grading', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: dir }])
    const result = runHook(
      dir,
      { tool_input: { subagent_type: 'unknown-type', prompt: 'do a thing for #100' } },
      { ARBITER_SPAWN_GUARD_HARD: '1' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('SPAWN GUARD')
  })

  it('exits 0 with advisory stderr: same scenario at soft (default) grading', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: dir }])
    const result = runHook(dir, {
      tool_input: { subagent_type: 'unknown-type', prompt: 'do a thing for #100' },
    })
    expect(result.status).toBe(0)
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
      tool_input: {
        subagent_type: 'general-purpose',
        isolation: 'worktree',
        prompt: 'work on #100',
      },
    })
    expect(result.status).toBe(0)
    const sidecar = JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
    expect(sidecar.length).toBe(2)
  })

  it('exits 2: prompt referencing more than one distinct task id (M2), hard grading', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const result = runHook(
      dir,
      {
        tool_input: {
          subagent_type: 'general-purpose',
          isolation: 'worktree',
          prompt: 'work on #12 and also #34',
        },
      },
      { ARBITER_SPAWN_GUARD_HARD: '1' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('one-task-per-dispatch')
  })

  it('#2403 AC-2: an M2-rejected spawn leaves no sidecar entry (hard grading)', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const result = runHook(
      dir,
      {
        tool_input: {
          subagent_type: 'general-purpose',
          isolation: 'worktree',
          prompt: 'work on #12 and also #34',
        },
      },
      { ARBITER_SPAWN_GUARD_HARD: '1' },
    )
    expect(result.status).toBe(2)
    expect(existsSync(join(dir, '.arbiter', 'agents-active.json'))).toBe(false)
  })

  it('#2403 AC-2: a second-writer-rejected spawn leaves the sidecar unchanged (hard grading)', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: 1, cwd: dir }])
    const result = runHook(
      dir,
      { tool_input: { subagent_type: 'unknown-type', prompt: 'do a thing for #100' } },
      { ARBITER_SPAWN_GUARD_HARD: '1' },
    )
    expect(result.status).toBe(2)
    const sidecar = JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
    expect(sidecar.length).toBe(1)
  })

  it('exits 0 with advisory stderr: same M2 violation at soft (default) grading', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const result = runHook(dir, {
      tool_input: {
        subagent_type: 'general-purpose',
        isolation: 'worktree',
        prompt: 'work on #12 and also #34',
      },
    })
    expect(result.status).toBe(0)
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

  // #2588: the hook process (and its `/bin/sh -c` parent) exits at once, so the entry must
  // carry the session pid Claude Code exports as CLAUDE_PID — otherwise pid-liveness pruning
  // would drop every registration and the guard would never block a second writer.
  it('#2588 AC-4: registers the session pid, so a second write-intent spawn is still blocked (hard grading)', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const payload = { tool_input: { subagent_type: 'general-purpose', prompt: 'work on #100' } }
    // The hook's grandparent stands in for the session, as under `/bin/sh -c node hook.mjs`.
    const env = { ARBITER_SPAWN_GUARD_HARD: '1', CLAUDE_PID: String(process.ppid) }
    expect(runHook(dir, payload, env).status).toBe(0)
    const sidecar = JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
    expect(sidecar[0].pid).toBe(process.ppid)
    expect(runHook(dir, payload, env).status).toBe(2)
  })

  it('#2588 AC-4: a CLAUDE_PID naming the hook itself or its direct parent is not recorded', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    // spawnSync makes this test process the hook's direct parent: a transient launcher pid.
    const result = runHook(
      dir,
      { tool_input: { subagent_type: 'general-purpose', prompt: 'work on #100' } },
      { CLAUDE_PID: String(process.pid) },
    )
    expect(result.status).toBe(0)
    const sidecar = JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
    expect(sidecar[0]).not.toHaveProperty('pid')
  })

  it('#2588 AC-1: a dead-pid entry no longer blocks a write-intent spawn (hard grading)', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid
    writeSidecar(dir, [{ agent: 'general-purpose', ts: Date.now(), pid: deadPid, cwd: dir }])
    const result = runHook(
      dir,
      { tool_input: { subagent_type: 'general-purpose', prompt: 'work on #100' } },
      { ARBITER_SPAWN_GUARD_HARD: '1', CLAUDE_PID: String(process.ppid) },
    )
    expect(result.status).toBe(0)
  })

  it('#2588 AC-3: without CLAUDE_PID the entry is registered with no pid (age-only)', () => {
    const dir = track(setup())
    writeWriteClasses(dir, { 'codebase-scanner': 'read-only' })
    const result = runHook(dir, {
      tool_input: { subagent_type: 'general-purpose', prompt: 'work on #100' },
    })
    expect(result.status).toBe(0)
    const sidecar = JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-active.json'), 'utf-8'))
    expect(sidecar[0]).not.toHaveProperty('pid')
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
