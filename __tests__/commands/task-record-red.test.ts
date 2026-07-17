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

  it.each(['typescript', 'java', 'kotlin', 'rust', 'multi'] as const)(
    'auto-selects the vitest runner for language %s (no bespoke mapping) (#1951)',
    (language) => {
      const dir = tmpRepo()
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language }), 'utf-8')
      mockedRunCli
        .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
        .mockReturnValueOnce({
          stdout: 'FAIL src/foo.test.ts\n1 failed',
          stderr: '',
          exitCode: 1,
          durationMs: 50,
        })
      runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
      expect(mockedRunCli.mock.calls[1]).toEqual([
        'npx',
        ['vitest', 'run', 'src/foo.test.ts'],
        expect.any(Object),
      ])
    },
  )

  it('scopes `go test` to `.` for a root-level go test file (#1951)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'go' }), 'utf-8')
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '--- FAIL: TestMain (0.00s)\nmain_test.go:1: nope',
        stderr: '',
        exitCode: 1,
        durationMs: 50,
      })
    runTaskRecordRed({ testPath: 'main_test.go', dir })
    expect(mockedRunCli.mock.calls[1]).toEqual(['go', ['test', '.'], expect.any(Object)])
  })

  it('keeps an already-prefixed go package dir verbatim (#1951)', () => {
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
    runTaskRecordRed({ testPath: './pkg/foo_test.go', dir })
    expect(mockedRunCli.mock.calls[1]).toEqual(['go', ['test', './pkg'], expect.any(Object)])
  })

  it.each([
    [500, 1000],
    [Number.NaN, 1000],
    [5000.5, 5000],
  ])('clamps/normalises timeoutMs %s to %s before the run (#1951)', (given, expected) => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '--- FAIL: TestFoo\n',
        stderr: '',
        exitCode: 1,
        durationMs: 5,
      })
    runTaskRecordRed({ testPath: 'src/foo.test.ts', dir, timeoutMs: given })
    const testCallOpts = mockedRunCli.mock.calls[1][2] as { timeoutMs: number }
    expect(testCallOpts.timeoutMs).toBe(expected)
  })

  it('records evidence when the failure signature appears only on stderr of a zero-exit run', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: 'suite started',
        stderr: 'FAIL src/foo.test.ts\n1 failed',
        exitCode: 0,
        durationMs: 50,
      })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(true)
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_run_log).toContain('suite started')
    expect(ev.test_run_log).toContain('FAIL src/foo.test.ts')
  })

  it('captures both stdout and stderr from a failing (throwing) test run', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockImplementationOnce(() => {
        // Real runCli throws a CliError carrying the child's output on non-zero exit.
        throw Object.assign(new Error('exit 1'), {
          stdout: 'FAIL src/foo.test.ts\n1 failed',
          stderr: 'deprecation warning: old flag',
        })
      })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(true)
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_run_log).toContain('FAIL src/foo.test.ts')
    expect(ev.test_run_log).toContain('deprecation warning: old flag')
  })

  it('captures a failing run whose stderr is empty without appending a stray newline', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('exit 1'), {
          stdout: 'FAIL src/foo.test.ts\n1 failed',
          stderr: '',
        })
      })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(true)
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_run_log).toBe('FAIL src/foo.test.ts\n1 failed')
  })

  it('stringifies a non-Error launch failure into the reason', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockImplementationOnce(() => {
        throw 'spawn blew up' // deliberately a non-Error value
      })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/failed to launch/)
    expect(result.reason).toMatch(/spawn blew up/)
  })

  it('stringifies a non-Error git rev-parse failure into the reason', () => {
    const dir = tmpRepo()
    mockedRunCli.mockImplementationOnce(() => {
      throw 'git exploded' // deliberately a non-Error value
    })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/git rev-parse/)
    expect(result.reason).toMatch(/git exploded/)
  })

  it('refuses when __tests__/** is dirty (staged or unstaged) (#1988)', () => {
    const dir = tmpRepo()
    mockedRunCli
      // git rev-parse HEAD
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      // git status --porcelain -- __tests__ → dirty test file reported
      .mockReturnValueOnce({
        stdout: ' M __tests__/evidence/tdd.test.ts\n',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
    const result = runTaskRecordRed({ testPath: '__tests__/evidence/tdd.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/commit the red test first/i)
    expect(result.reason).toMatch(/--force/)
    // No test run should have been attempted (only 2 runCli calls: rev-parse + status).
    expect(mockedRunCli).toHaveBeenCalledTimes(2)
  })

  it('--force overrides the dirty-__tests__ refusal and proceeds to record (#1988)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      // dirty check is skipped entirely under --force, so next call is the
      // HEAD-presence check (ls-tree), which we make pass...
      .mockReturnValueOnce({
        stdout: '100644 blob abc\t__tests__/evidence/tdd.test.ts\n',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
      // ...then the actual test run (fails, as expected for RED).
      .mockReturnValueOnce({
        stdout: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 failed',
        stderr: '',
        exitCode: 1,
        durationMs: 500,
      })
    const result = runTaskRecordRed({
      testPath: '__tests__/evidence/tdd.test.ts',
      dir,
      force: true,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses when the recorded test_path is absent from HEAD (#1988)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      // git status --porcelain -- __tests__ → clean
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
      // git ls-tree HEAD <path> → empty stdout means the path is not in HEAD
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
    const result = runTaskRecordRed({ testPath: '__tests__/evidence/missing.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not found in head|not found in commit/i)
    expect(result.reason).toMatch(/--force/)
    expect(mockedRunCli).toHaveBeenCalledTimes(3)
  })

  it('--force overrides the missing-test-in-HEAD refusal (#1988)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: 'FAIL __tests__/evidence/missing.test.ts\n✗ 1 failed',
        stderr: '',
        exitCode: 1,
        durationMs: 500,
      })
    const result = runTaskRecordRed({
      testPath: '__tests__/evidence/missing.test.ts',
      dir,
      force: true,
    })
    expect(result.ok).toBe(true)
    // Under --force, neither the dirty-check nor the HEAD-presence check runs:
    // only rev-parse + the test run itself (2 calls total).
    expect(mockedRunCli).toHaveBeenCalledTimes(2)
  })

  it('records evidence when __tests__/** is clean and the test path exists in HEAD (#1988)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '100644 blob abc\t__tests__/evidence/tdd.test.ts\n',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
      .mockReturnValueOnce({
        stdout: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 failed',
        stderr: '',
        exitCode: 1,
        durationMs: 500,
      })
    const result = runTaskRecordRed({ testPath: '__tests__/evidence/tdd.test.ts', dir })
    expect(result.ok).toBe(true)
  })

  it('dirty check ignores changes outside __tests__/** (#1988)', () => {
    const dir = tmpRepo()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      // git status scoped to __tests__ returns nothing even though other
      // paths in the repo are dirty (scoping is via pathspec, not filtering).
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
      .mockReturnValueOnce({
        stdout: '100644 blob abc\t__tests__/evidence/tdd.test.ts\n',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
      .mockReturnValueOnce({
        stdout: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 failed',
        stderr: '',
        exitCode: 1,
        durationMs: 500,
      })
    const result = runTaskRecordRed({ testPath: '__tests__/evidence/tdd.test.ts', dir })
    expect(result.ok).toBe(true)
  })

  it('falls back to process.cwd() when no dir is given', () => {
    const d = mkdtempSync(join(tmpdir(), 'record-red-cwd-'))
    dirs.push(d)
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(d)
    try {
      const result = runTaskRecordRed({ testPath: 'src/foo.test.ts' })
      // No .claude/.task-id in the cwd fixture → the cwd fallback was used.
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/no active task/i)
    } finally {
      cwdSpy.mockRestore()
    }
  })
})
