// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { runTaskRecordRed } from '../../src/commands/task-record-red.js'

// Mock runCli so we don't invoke real test runners
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {},
}))

import { runCli } from '../../src/utils/run-cli.js'
const mockedRunCli = vi.mocked(runCli)

function gitSha(): string {
  return 'b'.repeat(40)
}

describe('runTaskRecordRed()', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
    vi.clearAllMocks()
  })

  function tmpRepo(taskId = '#551'): string {
    const d = mkdtempSync(join(tmpdir(), 'record-red-test-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeFileSync(join(d, '.claude', '.task-id'), `${taskId}\n`, 'utf-8')
    return d
  }

  it('writes evidence file when test fails with recognised signature', () => {
    const dir = tmpRepo()
    const testPath = '__tests__/evidence/tdd.test.ts'
    const failLog = 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 failed'

    // git rev-parse HEAD → sha
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      // npm test <path> → non-zero (test fails)
      .mockReturnValueOnce({ stdout: failLog, stderr: '', exitCode: 1, durationMs: 500 })

    const result = runTaskRecordRed({ testPath, dir })
    expect(result.ok).toBe(true)

    const evPath = join(dir, '.arbiter', 'evidence', 'tdd', '#551.json')
    expect(existsSync(evPath)).toBe(true)
    const ev = JSON.parse(readFileSync(evPath, 'utf-8'))
    expect(ev.task_id).toBe('#551')
    expect(ev.test_commit_sha).toBe(gitSha())
    expect(ev.test_run_log).toContain('FAIL')
    expect(ev.$schemaVersion).toBe(1)
  })

  it('returns ok:false when test passes (no failure signature)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: 'All tests passed.',
        stderr: '',
        exitCode: 0,
        durationMs: 200,
      })

    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/pass|no failure/i)
  })

  it('returns ok:false when .claude/.task-id is missing', () => {
    const d = mkdtempSync(join(tmpdir(), 'record-red-notask-'))
    dirs.push(d)
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir: d })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no active task/i)
  })

  it('returns ok:false when the active task id is empty/whitespace', () => {
    const d = mkdtempSync(join(tmpdir(), 'record-red-empty-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeFileSync(join(d, '.claude', '.task-id'), '   \n', 'utf-8')
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir: d })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no active task/i)
  })

  it('returns ok:false when git rev-parse fails', () => {
    const dir = tmpRepo()
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('not a git repository')
    })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/git rev-parse/)
  })

  it('returns ok:false when test command fails to launch (non-CliError)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockImplementationOnce(() => {
        throw new Error('ENOENT: spawn failed')
      })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/launch/)
  })

  it('uses an explicit testCmd verbatim (no shell interpolation) and persists it (#1951)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '--- FAIL: TestFoo (0.00s)\nfoo_test.go:12: boom',
        stderr: '',
        exitCode: 1,
        durationMs: 100,
      })
    const result = runTaskRecordRed({
      testPath: 'pkg/foo_test.go',
      dir,
      testCmd: ['go', 'test', '-run', 'TestFoo', './pkg'],
    })
    expect(result.ok).toBe(true)
    // The test command is passed verbatim (binary + args), no shell joining.
    expect(mockedRunCli.mock.calls[1]).toEqual([
      'go',
      ['test', '-run', 'TestFoo', './pkg'],
      expect.any(Object),
    ])
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_command).toEqual(['go', 'test', '-run', 'TestFoo', './pkg'])
  })

  it('clamps the timeout into [1000, 600000] and forwards it to runCli (#1951)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '--- FAIL: TestFoo\n',
        stderr: '',
        exitCode: 1,
        durationMs: 5,
      })
    runTaskRecordRed({ testPath: 'src/foo.test.ts', dir, timeoutMs: 9_999_999 })
    // runCli call for the test (index 1) receives the clamped timeout.
    const testCallOpts = mockedRunCli.mock.calls[1][2] as { timeoutMs: number }
    expect(testCallOpts.timeoutMs).toBe(600_000)
  })

  it('auto-selects `go test <pkg-dir>` when the project language is go (#1951)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'go' }), 'utf-8')
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '--- FAIL: TestFoo (0.00s)\nfoo_test.go:1: nope',
        stderr: '',
        exitCode: 1,
        durationMs: 50,
      })
    runTaskRecordRed({ testPath: 'pkg/foo_test.go', dir })
    expect(mockedRunCli.mock.calls[1]).toEqual(['go', ['test', './pkg'], expect.any(Object)])
  })

  it('auto-selects `pytest <path>` when the project language is python (#1951)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'python' }), 'utf-8')
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '=== FAILURES ===\nFAILED tests/test_foo.py::test_foo - boom',
        stderr: '',
        exitCode: 1,
        durationMs: 50,
      })
    runTaskRecordRed({ testPath: 'tests/test_foo.py', dir })
    expect(mockedRunCli.mock.calls[1]).toEqual([
      'pytest',
      ['tests/test_foo.py'],
      expect.any(Object),
    ])
  })
})
