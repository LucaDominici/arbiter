// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as clack from '@clack/prompts'
import { runInit } from '../../src/commands/init.js'
import { _registerTmpPath } from '../../src/utils/fs.js'

// The wizard collects answers via @clack/prompts. A user abort (Ctrl+C /
// Escape) surfaces as a cancel symbol — clack does NOT throw. We simulate that
// by returning a cancel symbol from the first prompt and making isCancel()
// recognise it.
const CANCEL = Symbol('clack-cancel')

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn((v: unknown) => typeof v === 'symbol'),
}))

/** Make every prompt return the cancel symbol (abort at the first prompt). */
function mockUserAbort(): void {
  vi.mocked(clack.confirm).mockResolvedValue(CANCEL as never)
  vi.mocked(clack.select).mockResolvedValue(CANCEL as never)
  vi.mocked(clack.multiselect).mockResolvedValue(CANCEL as never)
  vi.mocked(clack.text).mockResolvedValue(CANCEL as never)
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-abort-test-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' })
}

describe('wizard abort (#621)', () => {
  let dir: string

  beforeEach(() => {
    vi.clearAllMocks()
    dir = tmpDir()
    initGit(dir)
    process.exitCode = 0
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = 0
    vi.restoreAllMocks()
  })

  it('sets exitCode 130 when user aborts wizard', async () => {
    mockUserAbort()

    await runInit({
      yes: false,
      tools: undefined,
      level: undefined,
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(process.exitCode).toBe(130)
  })

  it('cleans up in-flight tmp files when user aborts wizard', async () => {
    // Pre-seed a real in-flight tmp file to prove cleanup actually fires
    const tmpFile = join(dir, '.arbiter-tmp-deadbeef')
    writeFileSync(tmpFile, '')
    _registerTmpPath(tmpFile)

    mockUserAbort()

    await runInit({
      yes: false,
      tools: undefined,
      level: undefined,
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })

    expect(existsSync(tmpFile)).toBe(false)
    const tmpFiles = readdirSync(dir).filter((f) => f.startsWith('.arbiter-tmp-'))
    expect(tmpFiles).toHaveLength(0)
  })
})
