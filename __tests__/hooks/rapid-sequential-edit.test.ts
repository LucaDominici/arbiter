// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK = join(__dirname, '..', '..', '.claude', 'hooks', 'debug-state-on-failure.mjs')

function invokeHook(cwd: string, command = 'npm run test'): void {
  const payload = JSON.stringify({ tool_input: { command }, error: 'test suite failed' })
  execFileSync('node', [HOOK], { input: payload, encoding: 'utf-8', cwd })
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-seq-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  mkdirSync(join(dir, '.claude'), { recursive: true })
  return dir
}

describe('debug-state-on-failure hook — sequential invocations (#615)', () => {
  let dir: string

  beforeEach(() => {
    dir = makeRepo()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates DEBUG_STATE.md on first invocation', () => {
    invokeHook(dir)
    const evidenceDir = join(dir, '.evidence')
    const entries = execFileSync('find', [evidenceDir, '-name', 'DEBUG_STATE.md'], {
      encoding: 'utf-8',
    }).trim()
    expect(entries).toBeTruthy()
  })

  it('records exactly 5 attempt entries after 5 sequential invocations', () => {
    for (let i = 0; i < 5; i++) {
      invokeHook(dir)
    }

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

  it('header section appears exactly once', () => {
    for (let i = 0; i < 3; i++) {
      invokeHook(dir)
    }

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
