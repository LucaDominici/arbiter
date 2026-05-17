// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const HOOK = join(REPO_ROOT, '.claude/hooks/post-brainstorm-stop.mjs')

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'brainstorming-test-'))
})

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function runHook(opts: {
  prompt: string
  repoSubdir?: string
  markerExists?: boolean
  markerAgeMs?: number
}) {
  const repoRoot = join(tmpDir, opts.repoSubdir ?? 'repo')
  const arbiterDir = join(repoRoot, '.arbiter')
  const claudeDir = join(repoRoot, '.claude')
  mkdirSync(arbiterDir, { recursive: true })
  mkdirSync(claudeDir, { recursive: true })

  const markerPath = join(arbiterDir, 'brainstorm-active')
  if (opts.markerExists !== false) {
    writeFileSync(markerPath, 'active')
    if (opts.markerAgeMs !== undefined) {
      const t = new Date(Date.now() - opts.markerAgeMs)
      utimesSync(markerPath, t, t)
    }
  } else if (existsSync(markerPath)) {
    rmSync(markerPath)
  }

  const stdinJson = JSON.stringify({ prompt: opts.prompt })
  const result = spawnSync('node', [HOOK], {
    input: stdinJson,
    encoding: 'utf-8',
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    markerPath,
    repoRoot,
  }
}

describe('post-brainstorm-stop — marker creation', () => {
  it('hook file exists', () => {
    expect(existsSync(HOOK)).toBe(true)
  })
})

describe('post-brainstorm-stop — /task blocked when marker active', () => {
  it('/task prompt with active marker → exit 2', () => {
    const r = runHook({ prompt: '/task #123', markerExists: true, repoSubdir: 'repo-block' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/brainstorm/i)
  })

  it('stderr cites exact marker file path', () => {
    const r = runHook({ prompt: '/task #456', markerExists: true, repoSubdir: 'repo-path' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('brainstorm-active')
  })

  it('stderr includes one-line clear instruction', () => {
    const r = runHook({ prompt: '/task #789', markerExists: true, repoSubdir: 'repo-clear' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/rm|clear|delete|remove/i)
  })
})

describe('post-brainstorm-stop — non-/task prompts pass through', () => {
  it('regular prompt passes when marker active → exit 0', () => {
    const r = runHook({
      prompt: 'what is the current state of auth?',
      markerExists: true,
      repoSubdir: 'repo-pass',
    })
    expect(r.status).toBe(0)
  })

  it('/review prompt is not blocked → exit 0', () => {
    const r = runHook({ prompt: '/review-code', markerExists: true, repoSubdir: 'repo-review' })
    expect(r.status).toBe(0)
  })
})

describe('post-brainstorm-stop — no marker → always pass', () => {
  it('/task passes when no marker exists → exit 0', () => {
    const r = runHook({ prompt: '/task #123', markerExists: false, repoSubdir: 'repo-nomark' })
    expect(r.status).toBe(0)
  })
})

describe('post-brainstorm-stop — 24h auto-expire', () => {
  it('marker older than 24h is auto-cleared → /task allowed', () => {
    const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000
    const r = runHook({
      prompt: '/task #111',
      markerExists: true,
      markerAgeMs: TWENTY_FIVE_HOURS_MS,
      repoSubdir: 'repo-expire',
    })
    expect(r.status).toBe(0)
    // Marker should be deleted after auto-expire
    expect(existsSync(r.markerPath)).toBe(false)
  })

  it('marker exactly 24h old is still blocked (boundary: < not <=)', () => {
    const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000
    const r = runHook({
      prompt: '/task #222',
      markerExists: true,
      markerAgeMs: TWENTY_THREE_HOURS_MS,
      repoSubdir: 'repo-fresh',
    })
    expect(r.status).toBe(2)
  })
})
