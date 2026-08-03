// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeVerifyReport } from '../../src/compatibility/schema.js'

vi.mock('../../src/compatibility/probe.js', () => ({
  runProbes: vi.fn(),
}))

import { runProbes } from '../../src/compatibility/probe.js'
import { runInit } from '../../src/commands/init.js'

const mockRunProbes = vi.mocked(runProbes)

class ProcessExit extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
    this.name = 'ProcessExit'
  }
}

describe('runInit toolchain verification atomicity (#2137)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-init-atomicity-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }))
    writeFileSync(join(dir, 'tsconfig.json'), '{}\n')
    mockRunProbes.mockReturnValue(
      makeVerifyReport(dir, 'typescript', [
        { tool: 'node', status: 'failed', reason: 'test toolchain failure' },
      ]),
    )
    vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ProcessExit(code ?? 0)
    }) as typeof process.exit)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('aborts before generated files or Git hooks are written (AC1, AC2)', async () => {
    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L1',
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: false,
        quiet: true,
      }),
    ).rejects.toBeInstanceOf(ProcessExit)

    expect.soft(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
    expect.soft(existsSync(join(dir, 'scripts', 'check-all.mjs'))).toBe(false)
    expect.soft(existsSync(join(dir, 'arbiter.json'))).toBe(false)
    expect.soft(existsSync(join(dir, '.githooks'))).toBe(false)

    let hooksPath = ''
    try {
      hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: dir })
        .toString()
        .trim()
    } catch {
      // `git config --get` exits 1 when no hooks path has been configured.
    }
    expect.soft(hooksPath).toBe('')
  })
})
