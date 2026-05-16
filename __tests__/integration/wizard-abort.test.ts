// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import inquirer from 'inquirer'
import { runInit } from '../../src/commands/init.js'
import { _registerTmpPath } from '../../src/utils/fs.js'

vi.mock('inquirer', () => ({
  default: { prompt: vi.fn() },
}))

const mockPrompt = vi.mocked(inquirer.prompt)

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-abort-test-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' })
}

function makeExitError(): Error {
  return Object.assign(new Error('User force closed prompt with 0'), {
    name: 'ExitPromptError',
  })
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
    mockPrompt.mockRejectedValueOnce(makeExitError())

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

    mockPrompt.mockRejectedValueOnce(makeExitError())

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
