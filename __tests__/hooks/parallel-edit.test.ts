// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK = join(__dirname, '..', '..', '.claude', 'hooks', 'debug-state-on-failure.mjs')

function invokeHookAsync(cwd: string, command = 'npm run test'): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ tool_input: { command }, error: 'test suite failed' })
    const child = spawn('node', [HOOK], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.write(payload)
    child.stdin.end()
    child.on('close', (code) => {
      if (code === 0 || code === null) resolve()
      else reject(new Error(`hook exited ${code}`))
    })
    child.on('error', reject)
  })
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-par-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  mkdirSync(join(dir, '.claude'), { recursive: true })
  return dir
}

describe('debug-state-on-failure hook — parallel invocations (#615, CONC-3)', () => {
  let dir: string

  beforeEach(() => {
    dir = makeRepo()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('records exactly 5 attempt entries when 5 invocations run concurrently', async () => {
    await Promise.all(Array.from({ length: 5 }, () => invokeHookAsync(dir)))

    const evidenceDir = join(dir, '.evidence')
    const debugFiles = execFileSync('find', [evidenceDir, '-name', 'DEBUG_STATE.md'], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)

    expect(debugFiles).toHaveLength(1)

    const content = readFileSync(debugFiles[0]!, 'utf-8')
    const attemptCount = (content.match(/^### Attempt —/gm) ?? []).length
    expect(attemptCount).toBe(5)
  })

  it('header section appears exactly once despite concurrent first-write race', async () => {
    await Promise.all(Array.from({ length: 5 }, () => invokeHookAsync(dir)))

    const evidenceDir = join(dir, '.evidence')
    const debugFile = execFileSync('find', [evidenceDir, '-name', 'DEBUG_STATE.md'], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')[0]!

    const content = readFileSync(debugFile, 'utf-8')
    const headerCount = (content.match(/^# Debug State — Task /gm) ?? []).length
    expect(headerCount).toBe(1)
  })
})
