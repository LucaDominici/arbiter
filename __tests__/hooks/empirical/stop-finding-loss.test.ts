// E6b (#1948): finding-loss Stop hook. IMPLEMENT-BUT-NOT-ACTIVATED (OD-14) —
// this hook is not wired in .claude/settings.json's Stop chain; these are
// empirical exit-code tests run by spawning the hook file directly, per design
// doc §E6b red-path.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

const HOOK_PATH = resolve(import.meta.dirname, '../../../.claude/hooks/stop-finding-loss.mjs')

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-finding-loss-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

interface ToolUseBlock {
  type: 'tool_use'
  name: string
}

function writeTranscript(dir: string, dispatchCount: number, sessionStartIso: string): string {
  const p = join(dir, 'transcript.jsonl')
  const lines: string[] = []
  lines.push(
    JSON.stringify({
      type: 'user',
      timestamp: sessionStartIso,
      message: { role: 'user', content: [{ type: 'text', text: 'start' }] },
    }),
  )
  const blocks: ToolUseBlock[] = Array.from({ length: dispatchCount }, () => ({
    type: 'tool_use',
    name: 'Task',
  }))
  lines.push(
    JSON.stringify({
      type: 'assistant',
      timestamp: sessionStartIso,
      message: { role: 'assistant', content: blocks },
    }),
  )
  writeFileSync(p, lines.join('\n') + '\n')
  return p
}

function writeFindingsSpool(dir: string, tsIso: string): void {
  const findingsDir = join(dir, '.arbiter', 'findings')
  mkdirSync(findingsDir, { recursive: true })
  writeFileSync(
    join(findingsDir, 'shard-1.jsonl'),
    JSON.stringify({ ts: tsIso, note: 'x', kind: 'smell', severity: 'low' }) + '\n',
  )
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
    env: { ...process.env, ...env },
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

describe('stop-finding-loss hook (#1948, design doc §E6b)', () => {
  it('exits 2: 3 dispatches + empty findings dir + hard grading', () => {
    const dir = track(setup())
    const transcript = writeTranscript(dir, 3, new Date().toISOString())
    const result = runHook(
      dir,
      { transcript_path: transcript },
      { ARBITER_FINDING_LOSS_HARD: '1' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('FINDING LOSS')
  })

  it('exits 0 with stderr advisory: same scenario at soft grading', () => {
    const dir = track(setup())
    const transcript = writeTranscript(dir, 3, new Date().toISOString())
    const result = runHook(dir, { transcript_path: transcript })
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('FINDING LOSS')
  })

  it('exits 0 silently: dispatches + one in-window spool line', () => {
    const dir = track(setup())
    const start = new Date(Date.now() - 60_000).toISOString()
    const transcript = writeTranscript(dir, 3, start)
    writeFindingsSpool(dir, new Date().toISOString())
    const result = runHook(
      dir,
      { transcript_path: transcript },
      { ARBITER_FINDING_LOSS_HARD: '1' },
    )
    expect(result.status).toBe(0)
  })

  it('exits 0: unreadable transcript stands down (FAIL-OPEN-INTENT)', () => {
    const dir = track(setup())
    const result = runHook(
      dir,
      { transcript_path: join(dir, 'does-not-exist.jsonl') },
      { ARBITER_FINDING_LOSS_HARD: '1' },
    )
    expect(result.status).toBe(0)
  })

  it('exits 0: fewer than 2 dispatches never flags, even with zero persistence', () => {
    const dir = track(setup())
    const transcript = writeTranscript(dir, 1, new Date().toISOString())
    const result = runHook(
      dir,
      { transcript_path: transcript },
      { ARBITER_FINDING_LOSS_HARD: '1' },
    )
    expect(result.status).toBe(0)
  })

  it('exits 0: re-entry guard (stop_hook_active) always allows the stop', () => {
    const dir = track(setup())
    const transcript = writeTranscript(dir, 5, new Date().toISOString())
    const result = runHook(
      dir,
      { transcript_path: transcript, stop_hook_active: true },
      { ARBITER_FINDING_LOSS_HARD: '1' },
    )
    expect(result.status).toBe(0)
  })
})
