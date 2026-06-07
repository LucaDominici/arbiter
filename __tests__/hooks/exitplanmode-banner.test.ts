// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeTaskStateFile } from '../helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK = resolve(__dirname, '..', '..', '.claude', 'hooks', 'exitplanmode-banner.mjs')

function makeRepo(branch = 'task/#1210-test'): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-exitplanmode-'))
  mkdirSync(join(dir, '.claude'), { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  spawnSync('git', ['checkout', '-b', branch], { cwd: dir })
  spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

function runHook(cwd: string): { stdout: string; status: number | null } {
  const result = spawnSync('node', [HOOK], { cwd, encoding: 'utf-8' })
  return { stdout: result.stdout ?? '', status: result.status }
}

describe('exitplanmode-banner hook (#1210)', () => {
  let dir: string

  beforeEach(() => {
    dir = makeRepo()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('prints banner to stdout when phase is "plan" on a task branch', () => {
    writeTaskStateFile(dir, { taskId: '#1210', phase: 'plan' })
    const { stdout, status } = runHook(dir)
    expect(status).toBe(0)
    expect(stdout).toMatch(/\[arbiter\]/)
    expect(stdout).toMatch(/Plan mode ended/)
  })

  it('is silent when phase is "complete" on a task branch', () => {
    writeTaskStateFile(dir, { taskId: '#1210', phase: 'complete' })
    const { stdout, status } = runHook(dir)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('is silent when no task state file exists', () => {
    const { stdout, status } = runHook(dir)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})
