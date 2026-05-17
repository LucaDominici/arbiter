// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { runTaskRecordTechDebt } from '../../src/commands/task-record-tech-debt.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    exitCode: number
    stdout: string
    stderr: string
    timedOut: boolean
    notFound: boolean
    constructor(details: {
      exitCode: number
      stdout: string
      stderr: string
      timedOut: boolean
      notFound: boolean
    }) {
      super('CliError')
      this.exitCode = details.exitCode
      this.stdout = details.stdout
      this.stderr = details.stderr
      this.timedOut = details.timedOut
      this.notFound = details.notFound
    }
  },
}))

import { runCli, CliError } from '../../src/utils/run-cli.js'
const mockedRunCli = vi.mocked(runCli)
const MockedCliError = CliError as unknown as new (details: {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  notFound: boolean
}) => CliError

describe('runTaskRecordTechDebt()', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
    vi.clearAllMocks()
  })

  function tmpRepo(taskId = '#702'): string {
    const d = mkdtempSync(join(tmpdir(), 'record-td-test-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeFileSync(join(d, '.claude', '.task-id'), `${taskId}\n`, 'utf-8')
    return d
  }

  it('(a) happy path: gh returns issue URL → tech-debt.json + log.md written', () => {
    const dir = tmpRepo()
    mockedRunCli.mockReturnValueOnce({
      stdout: 'https://github.com/owner/repo/issues/42\n',
      stderr: '',
      exitCode: 0,
      durationMs: 200,
    })

    const result = runTaskRecordTechDebt({ description: 'missing input validation', dir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issueNumber).toBe(42)

    // tech-debt.json written
    const sanit = '_702'
    const tdPath = join(dir, '.arbiter', 'evidence', sanit, 'tech-debt.json')
    expect(existsSync(tdPath)).toBe(true)
    const td = JSON.parse(readFileSync(tdPath, 'utf-8')) as { issues: number[] }
    expect(td.issues).toContain(42)

    // log.md written
    const logPath = join(dir, '.arbiter', 'evidence', sanit, 'log.md')
    expect(existsSync(logPath)).toBe(true)
    const log = readFileSync(logPath, 'utf-8')
    expect(log).toContain('#42')
    expect(log).toContain('missing input validation')
  })

  it('(b) gh CliError (non-zero exit) → ok:false, tech-debt.json not modified', () => {
    const dir = tmpRepo()
    mockedRunCli.mockImplementationOnce(() => {
      throw new MockedCliError({
        exitCode: 1,
        stdout: '',
        stderr: 'auth required',
        timedOut: false,
        notFound: false,
      })
    })

    const result = runTaskRecordTechDebt({ description: 'some debt', dir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/gh exit|exit 1/i)

    const sanit = '_702'
    const tdPath = join(dir, '.arbiter', 'evidence', sanit, 'tech-debt.json')
    expect(existsSync(tdPath)).toBe(false)
  })

  it('(c) missing .claude/.task-id and no --triggered-by → fail-closed', () => {
    const d = mkdtempSync(join(tmpdir(), 'record-td-notask-'))
    dirs.push(d)

    const result = runTaskRecordTechDebt({ description: 'some debt', dir: d })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/task.?id|triggered.?by/i)
  })

  it('(d) gh returns non-integer stdout → ok:false soft-fail', () => {
    const dir = tmpRepo()
    mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 100 })

    const result = runTaskRecordTechDebt({ description: 'some debt', dir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/non-integer|integer/i)
  })

  it('(e) sequential appendTechDebtIssue calls preserve prior entries', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({
        stdout: 'https://github.com/owner/repo/issues/10\n',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      })
      .mockReturnValueOnce({
        stdout: 'https://github.com/owner/repo/issues/20\n',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      })

    const r1 = runTaskRecordTechDebt({ description: 'debt one', dir })
    const r2 = runTaskRecordTechDebt({ description: 'debt two', dir })

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)

    const sanit = '_702'
    const tdPath = join(dir, '.arbiter', 'evidence', sanit, 'tech-debt.json')
    const td = JSON.parse(readFileSync(tdPath, 'utf-8')) as { issues: number[] }
    expect(td.issues).toContain(10)
    expect(td.issues).toContain(20)
    expect(td.issues).toHaveLength(2)
  })
})
