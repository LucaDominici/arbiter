// SPDX-License-Identifier: Apache-2.0
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readlinkSync,
  existsSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  DEFAULT_RECORD_RED_TIMEOUT_MS,
  runTaskRecordRed,
  taskIdFromBranch,
} from '../../src/commands/task-record-red.js'
import { runVerifyTdd } from '../../src/commands/verify-tdd.js'

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

/**
 * Queue the `git rev-parse --abbrev-ref HEAD` response `runTaskRecordRed` now
 * issues FIRST, to resolve the branch-preferred task id (#2064). Call this
 * before any other mocked response in a test. Defaults to a branch that does
 * NOT match the `task/#NNN[-slug]` convention, so existing tests (which rely
 * on the task-document id from `tmpRepo()`) keep resolving exactly as before.
 */
function mockBranch(name = 'main'): void {
  mockedRunCli.mockReturnValueOnce({ stdout: name, stderr: '', exitCode: 0, durationMs: 5 })
}

/**
 * Queue the two mocked `runCli` responses record-red issues between
 * `git rev-parse HEAD` and the actual test run: a clean `git status`
 * scoped to the recorded test path and a non-empty `git ls-tree` (test path
 * present in HEAD). Call right after mocking rev-parse (#1988).
 */
function mockCleanGitChecks(testPath: string): void {
  mockedRunCli
    .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
    .mockReturnValueOnce({
      stdout: `100644 blob abc\t${testPath}\n`,
      stderr: '',
      exitCode: 0,
      durationMs: 10,
    })
}

describe('taskIdFromBranch() (#2064)', () => {
  it('extracts the id from the canonical task/#NNN-slug form', () => {
    expect(taskIdFromBranch('task/#503-gate-truth')).toBe('#503')
  })

  it('extracts the id from a task/NNN-slug branch missing the # (#2064 own worktree convention)', () => {
    expect(taskIdFromBranch('task/2064-record-red-branch-fix')).toBe('#2064')
  })

  it('extracts the id from a task/#NNN branch with no slug', () => {
    expect(taskIdFromBranch('task/#503')).toBe('#503')
  })

  it('returns undefined for detached HEAD', () => {
    expect(taskIdFromBranch('HEAD')).toBeUndefined()
  })

  it('returns undefined for a non-task branch', () => {
    expect(taskIdFromBranch('main')).toBeUndefined()
  })

  it("returns undefined for git-checks' 'unknown' sentinel (non-git-repo / failed lookup)", () => {
    expect(taskIdFromBranch('unknown')).toBeUndefined()
  })
})

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

    mockBranch()
    // git rev-parse HEAD → sha
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks(testPath)
    // npm test <path> → non-zero (test fails)
    mockedRunCli.mockReturnValueOnce({ stdout: failLog, stderr: '', exitCode: 1, durationMs: 500 })

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

  it('fails closed when the written receipt cannot be staged (#2862)', () => {
    const dir = tmpRepo()
    const testPath = '__tests__/evidence/tdd.test.ts'
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks(testPath)
    mockedRunCli.mockReturnValueOnce({
      stdout: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 failed',
      stderr: '',
      exitCode: 1,
      durationMs: 500,
    })
    mockedRunCli.mockReturnValueOnce({
      stdout: 'c'.repeat(40),
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('index.lock exists')
    })

    const result = runTaskRecordRed({ testPath, dir })
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/receipt .*#551\.json.* not staged: index\.lock exists/),
    })
    expect(mockedRunCli.mock.calls[6]).toEqual([
      'git',
      ['add', '-f', '--', '.arbiter/evidence/tdd/#551.json'],
      expect.objectContaining({ cwd: dir }),
    ])
  })

  it('runs a monorepo test from its nearest package root and records that cwd (#2801)', () => {
    const dir = tmpRepo()
    const testPath = 'frontend/src/ConfirmDialog.test.ts'
    mkdirSync(join(dir, 'frontend', 'src'), { recursive: true })
    mkdirSync(join(dir, 'backend'), { recursive: true })
    writeFileSync(join(dir, 'frontend', 'package.json'), '{"scripts":{"test":"vitest"}}\n')
    writeFileSync(join(dir, 'backend', 'pyproject.toml'), '[project]\nname = "backend"\n')
    writeFileSync(join(dir, testPath), 'it("fails", () => expect(1).toBe(2))\n')

    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks(testPath)
    mockedRunCli.mockReturnValueOnce({
      stdout: 'FAIL src/ConfirmDialog.test.ts\n1 failed',
      stderr: '',
      exitCode: 1,
      durationMs: 50,
    })

    expect(runTaskRecordRed({ testPath, dir }).ok).toBe(true)
    expect(mockedRunCli).toHaveBeenCalledWith(
      'npx',
      ['vitest', 'run', 'src/ConfirmDialog.test.ts'],
      { cwd: join(dir, 'frontend'), timeoutMs: DEFAULT_RECORD_RED_TIMEOUT_MS },
    )
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_cwd).toBe('frontend')
    expect(ev.test_command).toEqual(['npx', 'vitest', 'run', 'src/ConfirmDialog.test.ts'])
  })

  // #2116: a rebase rewrites test_commit_sha out of existence; the test's blob sha
  // survives it, so evidence pins the content too and can be re-resolved after a rebase.
  it('records the rebase-stable blob sha of the RED test', () => {
    const dir = tmpRepo()
    const testPath = '__tests__/evidence/tdd.test.ts'

    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks(testPath)
    mockedRunCli.mockReturnValueOnce({
      stdout: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 failed',
      stderr: '',
      exitCode: 1,
      durationMs: 500,
    })
    // git rev-parse <sha>:<test path> → blob sha
    mockedRunCli.mockReturnValueOnce({
      stdout: 'c'.repeat(40),
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })

    expect(runTaskRecordRed({ testPath, dir }).ok).toBe(true)
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_blob_sha).toBe('c'.repeat(40))
  })

  it('returns ok:false when test passes (no failure signature)', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockReturnValueOnce({
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
    mockBranch()
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('not a git repository')
    })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/git rev-parse/)
  })

  it('returns ok:false when test command fails to launch (non-CliError)', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('ENOENT: spawn failed')
    })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/launch/)
  })

  it('uses an explicit testCmd verbatim (no shell interpolation) and persists it (#1951)', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('pkg/foo_test.go')
    mockedRunCli.mockReturnValueOnce({
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
    // Index 4: branch(0), rev-parse(1), status(2), ls-tree(3), test run(4).
    expect(mockedRunCli.mock.calls[4]).toEqual([
      'go',
      ['test', '-run', 'TestFoo', './pkg'],
      expect.any(Object),
    ])
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_command).toEqual(['go', 'test', '-run', 'TestFoo', './pkg'])
  })

  it('stores a repo-local node_modules binary without the recording checkout path (#2712)', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockReturnValueOnce({
      stdout: 'FAIL src/foo.test.ts\n1 test failed',
      stderr: '',
      exitCode: 1,
      durationMs: 100,
    })
    const absoluteVitest = join(dir, 'node_modules', '.bin', 'vitest')
    const result = runTaskRecordRed({
      testPath: 'src/foo.test.ts',
      dir,
      testCmd: [absoluteVitest, 'run', 'src/foo.test.ts'],
    })
    expect(result.ok).toBe(true)
    expect(mockedRunCli.mock.calls[4]?.[0]).toBe(absoluteVitest)
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_command).toEqual(['node_modules/.bin/vitest', 'run', 'src/foo.test.ts'])
    expect(JSON.stringify(ev)).not.toContain(dir)
  })

  it('clamps the timeout into [1000, 600000] and forwards it to runCli (#1951)', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockReturnValueOnce({
      stdout: '--- FAIL: TestFoo\n',
      stderr: '',
      exitCode: 1,
      durationMs: 5,
    })
    runTaskRecordRed({ testPath: 'src/foo.test.ts', dir, timeoutMs: 9_999_999 })
    // runCli call for the test (index 4) receives the clamped timeout.
    const testCallOpts = mockedRunCli.mock.calls[4][2] as { timeoutMs: number }
    expect(testCallOpts.timeoutMs).toBe(600_000)
  })

  it('auto-selects `go test <pkg-dir>` when the project language is go (#1951)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'go' }), 'utf-8')
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('pkg/foo_test.go')
    mockedRunCli.mockReturnValueOnce({
      stdout: '--- FAIL: TestFoo (0.00s)\nfoo_test.go:1: nope',
      stderr: '',
      exitCode: 1,
      durationMs: 50,
    })
    runTaskRecordRed({ testPath: 'pkg/foo_test.go', dir })
    expect(mockedRunCli.mock.calls[4]).toEqual(['go', ['test', './pkg'], expect.any(Object)])
  })

  it('auto-selects `pytest <path>` when the project language is python (#1951)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'python' }), 'utf-8')
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('tests/test_foo.py')
    mockedRunCli.mockReturnValueOnce({
      stdout: '=== FAILURES ===\nFAILED tests/test_foo.py::test_foo - boom',
      stderr: '',
      exitCode: 1,
      durationMs: 50,
    })
    runTaskRecordRed({ testPath: 'tests/test_foo.py', dir })
    expect(mockedRunCli.mock.calls[4]).toEqual([
      'pytest',
      ['tests/test_foo.py'],
      expect.any(Object),
    ])
  })

  it('executes a shell test with bash whatever the project language (#2862)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'go' }), 'utf-8')
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('scripts/check.test.sh')
    mockedRunCli.mockReturnValueOnce({
      stdout: 'FAIL: expected violation',
      stderr: '',
      exitCode: 1,
      durationMs: 50,
    })
    runTaskRecordRed({ testPath: 'scripts/check.test.sh', dir })
    expect(mockedRunCli.mock.calls[4]).toEqual([
      'bash',
      ['scripts/check.test.sh'],
      expect.any(Object),
    ])
  })

  it.each(['typescript', 'java', 'kotlin', 'rust', 'multi'] as const)(
    'auto-selects the vitest runner for language %s (no bespoke mapping) (#1951)',
    (language) => {
      const dir = tmpRepo()
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language }), 'utf-8')
      mockBranch()
      mockedRunCli.mockReturnValueOnce({
        stdout: gitSha(),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
      mockCleanGitChecks('src/foo.test.ts')
      mockedRunCli.mockReturnValueOnce({
        stdout: 'FAIL src/foo.test.ts\n1 failed',
        stderr: '',
        exitCode: 1,
        durationMs: 50,
      })
      runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
      expect(mockedRunCli.mock.calls[4]).toEqual([
        'npx',
        ['vitest', 'run', 'src/foo.test.ts'],
        expect.any(Object),
      ])
    },
  )

  // #2656: a JS/TS test file is a vitest test whatever the repo language — a Go
  // consumer that tests its gate scripts with vitest must not get `go test ./scripts`.
  it.each([
    ['go', 'scripts/check-foo.test.mjs'],
    ['python', 'tools/foo.spec.ts'],
    ['go', 'web/app.test.tsx'],
  ] as const)(
    'selects vitest for a JS/TS test path in a %s project (#2656)',
    (language, testPath) => {
      const dir = tmpRepo()
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language }), 'utf-8')
      mockBranch()
      mockedRunCli.mockReturnValueOnce({
        stdout: gitSha(),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
      mockCleanGitChecks(testPath)
      mockedRunCli.mockReturnValueOnce({
        stdout: `FAIL ${testPath}\n1 failed`,
        stderr: '',
        exitCode: 1,
        durationMs: 50,
      })
      runTaskRecordRed({ testPath, dir })
      expect(mockedRunCli.mock.calls[4]).toEqual([
        'npx',
        ['vitest', 'run', testPath],
        expect.any(Object),
      ])
    },
  )

  it('scopes `go test` to `.` for a root-level go test file (#1951)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'go' }), 'utf-8')
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('main_test.go')
    mockedRunCli.mockReturnValueOnce({
      stdout: '--- FAIL: TestMain (0.00s)\nmain_test.go:1: nope',
      stderr: '',
      exitCode: 1,
      durationMs: 50,
    })
    runTaskRecordRed({ testPath: 'main_test.go', dir })
    expect(mockedRunCli.mock.calls[4]).toEqual(['go', ['test', '.'], expect.any(Object)])
  })

  it('keeps an already-prefixed go package dir verbatim (#1951)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'go' }), 'utf-8')
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('./pkg/foo_test.go')
    mockedRunCli.mockReturnValueOnce({
      stdout: '--- FAIL: TestFoo (0.00s)\nfoo_test.go:1: nope',
      stderr: '',
      exitCode: 1,
      durationMs: 50,
    })
    runTaskRecordRed({ testPath: './pkg/foo_test.go', dir })
    expect(mockedRunCli.mock.calls[4]).toEqual(['go', ['test', './pkg'], expect.any(Object)])
  })

  it.each([
    [500, 1000],
    [Number.NaN, 1000],
    [5000.5, 5000],
  ])('clamps/normalises timeoutMs %s to %s before the run (#1951)', (given, expected) => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockReturnValueOnce({
      stdout: '--- FAIL: TestFoo\n',
      stderr: '',
      exitCode: 1,
      durationMs: 5,
    })
    runTaskRecordRed({ testPath: 'src/foo.test.ts', dir, timeoutMs: given })
    const testCallOpts = mockedRunCli.mock.calls[4][2] as { timeoutMs: number }
    expect(testCallOpts.timeoutMs).toBe(expected)
  })

  it('refuses a zero-exit suite even when stderr contains a failure signature', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockReturnValueOnce({
      stdout: 'suite started',
      stderr: 'FAIL src/foo.test.ts\n1 failed',
      exitCode: 0,
      durationMs: 50,
    })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/exited 0.*suite passed.*RED phase/i)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'))).toBe(false)
  })

  it('refuses a non-zero runner whose output has no recognised failure signature', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockReturnValueOnce({
      stdout: 'runner stopped after receiving a signal',
      stderr: '',
      exitCode: 2,
      durationMs: 50,
    })

    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no recognised failure/i),
    })
    expect(result.reason).toContain(
      'Shell tests must print a line "FAIL: <label>" (leading spaces or tabs allowed, the colon is required).',
    )
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'))).toBe(false)
  })

  it('captures both stdout and stderr from a failing (throwing) test run', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockImplementationOnce(() => {
      // Real runCli throws a CliError carrying the child's output on non-zero exit.
      throw Object.assign(new Error('exit 1'), {
        stdout: 'FAIL src/foo.test.ts\n1 failed',
        stderr: 'deprecation warning: old flag',
        exitCode: 1,
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

  it.each([
    ['timed out', { timedOut: true }],
    ['was not found', { notFound: true }],
  ])('refuses to mint evidence when the failing runner %s', (_case, failureFlags) => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockImplementationOnce(() => {
      throw Object.assign(new Error('runner interrupted'), {
        stdout: 'FAIL src/foo.test.ts\n1 failed',
        stderr: '',
        exitCode: 1,
        ...failureFlags,
      })
    })

    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/failed to launch/i) })
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'))).toBe(false)
  })

  it('captures a failing run whose stderr is empty without appending a stray newline', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit 1'), {
        stdout: 'FAIL src/foo.test.ts\n1 failed',
        stderr: '',
        exitCode: 1,
      })
    })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(true)
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_run_log).toBe('FAIL src/foo.test.ts\n1 failed')
  })

  it('writes repository-relative paths instead of the absolute worktree path into test_run_log (#2174)', () => {
    const dir = tmpRepo()
    const absoluteTestPath = join(dir, 'sensitive-worktree', 'src', 'foo.test.ts')
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockReturnValueOnce({
      stdout: `FAIL ${absoluteTestPath}\n1 failed`,
      stderr: '',
      exitCode: 1,
      durationMs: 5,
    })

    expect(runTaskRecordRed({ testPath: 'src/foo.test.ts', dir }).ok).toBe(true)
    const ev = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'), 'utf-8'),
    )
    expect(ev.test_run_log).not.toContain(dir)
    expect(ev.test_run_log).toContain('sensitive-worktree/src/foo.test.ts')
  })

  it('stringifies a non-Error launch failure into the reason', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks('src/foo.test.ts')
    mockedRunCli.mockImplementationOnce(() => {
      throw 'spawn blew up' // deliberately a non-Error value
    })
    const result = runTaskRecordRed({ testPath: 'src/foo.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/failed to launch/)
    expect(result.reason).toMatch(/spawn blew up/)
  })

  it('stringifies a non-Error git rev-parse failure into the reason', () => {
    const dir = tmpRepo()
    mockBranch()
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
    mockBranch()
    mockedRunCli
      // git rev-parse HEAD
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      // git status --porcelain -- <test-path> → dirty test file reported
      .mockReturnValueOnce({
        stdout: ' M __tests__/evidence/tdd.test.ts\n',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
    const result = runTaskRecordRed({ testPath: '__tests__/evidence/tdd.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/commit the red test first/i)
    expect(result.reason).not.toMatch(/--force/)
    // branch(1) + rev-parse(1) + status(1) = 3 runCli calls total.
    expect(mockedRunCli).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['src/foo.test.ts', ' M src/foo.test.ts'],
    ['fixtures/example.yaml', '?? fixtures/example.yaml'],
  ])('refuses a dirty or untracked test path outside __tests__ (%s)', (testPath, status) => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      .mockImplementationOnce((_cmd, args) => ({
        // A clean __tests__ directory says nothing about a colocated or non-TS
        // test; only the exact recorded path reports this fixture's status.
        stdout: args.at(-1) === testPath ? status : '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      }))

    const result = runTaskRecordRed({ testPath, dir })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/commit the red test first/i)
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--', testPath],
      { cwd: dir, timeoutMs: 5000 },
    )
  })

  it('surfaces a Git status failure instead of treating the test path as clean', () => {
    const dir = tmpRepo()
    const testPath = 'src/foo.test.ts'
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('git status unavailable')
    })

    const result = runTaskRecordRed({ testPath, dir })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/git status.*unavailable|git status.*failed/i)
    expect(mockedRunCli).toHaveBeenCalledTimes(3)
  })

  it('surfaces a Git path lookup failure instead of reporting a missing test', () => {
    const dir = tmpRepo()
    const testPath = 'fixtures/example.yaml'
    mockBranch()
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('git ls-tree unavailable')
    })

    const result = runTaskRecordRed({ testPath, dir })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/git ls-tree.*unavailable|git ls-tree.*failed/i)
    expect(mockedRunCli).toHaveBeenCalledTimes(4)
  })

  it('refuses when the recorded test_path is absent from HEAD (#1988)', () => {
    const dir = tmpRepo()
    mockBranch()
    mockedRunCli
      .mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
      // git status --porcelain -- <test-path> → clean
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
      // git ls-tree HEAD <path> → empty stdout means the path is not in HEAD
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
    const result = runTaskRecordRed({ testPath: '__tests__/evidence/missing.test.ts', dir })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not found in head|not found in commit/i)
    expect(result.reason).not.toMatch(/--force/)
    // branch(1) + rev-parse(1) + status(1) + ls-tree(1) = 4.
    expect(mockedRunCli).toHaveBeenCalledTimes(4)
  })

  it('records evidence when __tests__/** is clean and the test path exists in HEAD (#1988)', () => {
    const dir = tmpRepo()
    mockBranch()
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
    mockBranch()
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

// #2064 — "record-red must prefer current branch and never overwrite another
// task's evidence". Each `it` below is one of the 6 documented test cases from
// the issue (github.com/LucaDominici/arbiter/issues/2064).
describe('runTaskRecordRed() branch-preference and evidence-ownership (#2064)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
    vi.clearAllMocks()
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'record-red-2064-'))
    dirs.push(d)
    return d
  }

  function seedTaskDoc(dir: string, taskId: string): void {
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', '.task-id'), `${taskId}\n`, 'utf-8')
  }

  function seedEvidence(dir: string, taskId: string, observedFailure: string): void {
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(
      join(evDir, `${taskId}.json`),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: taskId,
        test_path: '__tests__/prior.test.ts',
        test_commit_sha: 'a'.repeat(40),
        test_run_log: 'FAIL __tests__/prior.test.ts',
        observed_failure: observedFailure,
        recorded_at: '2026-01-01T00:00:00.000Z',
      }),
      'utf-8',
    )
  }

  function runOnBranch(
    branch: string,
    testPath: string,
    failLog: string,
    dir: string,
  ): ReturnType<typeof runTaskRecordRed> {
    mockBranch(branch)
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks(testPath)
    mockedRunCli.mockReturnValueOnce({ stdout: failLog, stderr: '', exitCode: 1, durationMs: 100 })
    return runTaskRecordRed({ testPath, dir })
  }

  // Test case 1: stale latest worktree log #489 + current branch #503 =>
  // writes only #503.json. Worktree open/close logs are never consulted for
  // resolution (issue resolution item 5) — no task-document is seeded here,
  // so the branch alone must resolve the task.
  it('prefers the current branch over historical worktree-log state (writes only #503.json)', () => {
    const dir = tmpRepo()
    const testPath = '__tests__/gate-truth.test.ts'
    const result = runOnBranch(
      'task/#503-gate-truth',
      testPath,
      `FAIL ${testPath}\n✗ 1 failed`,
      dir,
    )
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#503.json'))).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#489.json'))).toBe(false)
  })

  // Test case 2: existing #489.json + resolved task #503 => byte-identical
  // #489 after command.
  it('leaves an unrelated existing #489.json byte-identical when recording #503', () => {
    const dir = tmpRepo()
    seedEvidence(dir, '#489', 'original #489 evidence — must not change')
    const before = readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#489.json'), 'utf-8')

    const testPath = '__tests__/gate-truth.test.ts'
    const result = runOnBranch(
      'task/#503-gate-truth',
      testPath,
      `FAIL ${testPath}\n✗ 1 failed`,
      dir,
    )
    expect(result.ok).toBe(true)
    const after = readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#489.json'), 'utf-8')
    expect(after).toBe(before)
  })

  // Test case 3: branch/task-document mismatch => exit non-zero and no file
  // changes. This is the actual #503/#489 incident shape: a stale
  // task-document (`arbiter lifecycle start` never re-run after switching branches)
  // disagreeing with the real current branch.
  it('fails closed and writes nothing when branch and task-document disagree', () => {
    const dir = tmpRepo()
    seedTaskDoc(dir, '#489')
    seedEvidence(dir, '#489', 'pre-existing #489 evidence — must not change')
    const before = readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#489.json'), 'utf-8')

    mockBranch('task/#503-gate-truth')
    const result = runTaskRecordRed({ testPath: '__tests__/gate-truth.test.ts', dir })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/mismatch/i)
      expect(result.reason).toContain('#503')
      expect(result.reason).toContain('#489')
    }
    // No file changes: #489.json untouched, no #503.json ever created.
    expect(readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#489.json'), 'utf-8')).toBe(
      before,
    )
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#503.json'))).toBe(false)
    // Fails BEFORE any further git call (rev-parse/status/ls-tree/test run):
    // only the branch lookup happened.
    expect(mockedRunCli).toHaveBeenCalledTimes(1)
  })

  // Test case 4: detached CI checkout with explicit task context =>
  // deterministic task selection. Detached HEAD means `currentBranch()`
  // returns the literal 'HEAD' (git's own convention) — no task/#NNN pattern
  // to derive from — so the pre-set task-document (the CI job's explicit
  // `arbiter lifecycle start --id`) decides deterministically, same as before #2064.
  it('falls back deterministically to the task-document on a detached HEAD checkout', () => {
    const dir = tmpRepo()
    seedTaskDoc(dir, '#77')
    const testPath = '__tests__/ci.test.ts'
    const result = runOnBranch('HEAD', testPath, `FAIL ${testPath}\n✗ 1 failed`, dir)
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#77.json'))).toBe(true)
  })

  // Not one of the 6 numbered cases, but the base "everything agrees" path a
  // developer following the `task/#NNN-slug` convention hits every day —
  // locks in that agreement is silent success, not a spurious mismatch.
  it('proceeds normally when the branch-derived id and the task-document agree', () => {
    const dir = tmpRepo()
    seedTaskDoc(dir, '#551')
    const testPath = '__tests__/agree.test.ts'
    const result = runOnBranch('task/#551-agree', testPath, `FAIL ${testPath}\n✗ 1 failed`, dir)
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#551.json'))).toBe(true)
  })

  it('records a train secondary issue under its own explicit task id, not the branch primary (#2336)', () => {
    const dir = tmpRepo()
    mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#503', chainIds: ['#504'] }),
      'utf-8',
    )
    const testPath = '__tests__/secondary.test.ts'

    mockBranch('task/#503-primary')
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks(testPath)
    mockedRunCli.mockReturnValueOnce({
      stdout: `FAIL ${testPath}\n✗ 1 failed`,
      stderr: '',
      exitCode: 1,
      durationMs: 100,
    })

    const result = runTaskRecordRed({ testPath, dir, taskId: '#504' })

    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#504.json'))).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#503.json'))).toBe(false)
  })

  it.each(['#5040', ['#504', 504]])(
    'rejects malformed chainIds before authorizing secondary evidence: %j',
    (chainIds) => {
      const dir = tmpRepo()
      mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
      writeFileSync(
        join(dir, '.claude', '.task', 'status.json'),
        JSON.stringify({ taskId: '#503', chainIds }),
        'utf-8',
      )
      const testPath = '__tests__/secondary.test.ts'

      mockBranch('task/#503-primary')
      mockedRunCli.mockReturnValueOnce({
        stdout: gitSha(),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
      mockCleanGitChecks(testPath)
      mockedRunCli.mockReturnValueOnce({
        stdout: `FAIL ${testPath}\n✗ 1 failed`,
        stderr: '',
        exitCode: 1,
        durationMs: 100,
      })

      expect(() => runTaskRecordRed({ testPath, dir, taskId: '#504' })).toThrow(/chainIds/)
      expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#504.json'))).toBe(false)
    },
  )
})

// #2655 — an explicit `--task` is authoritative when NEITHER the branch nor the
// task document resolves (detached HEAD at the RED commit, a non-task branch):
// there is nothing for it to disagree with, so the #2064 fail-closed guard has
// no reason to demand a `task init` detour. Every other rule is unchanged.
describe('runTaskRecordRed() explicit --task with no resolvable active task (#2655)', () => {
  const dirs: string[] = []
  // mockReset (not clearAllMocks): a refusal or a throw consumes only the branch lookup
  // and would leak its queued rev-parse/status/ls-tree/test-run responses into the next
  // case — including from the preceding describe, hence the reset on entry too.
  beforeEach(() => mockedRunCli.mockReset())
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
    mockedRunCli.mockReset()
  })

  function bareRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'record-red-2655-'))
    dirs.push(d)
    return d
  }

  function mockFailingRun(branch: string, testPath: string): void {
    mockBranch(branch)
    mockedRunCli.mockReturnValueOnce({ stdout: gitSha(), stderr: '', exitCode: 0, durationMs: 10 })
    mockCleanGitChecks(testPath)
    mockedRunCli.mockReturnValueOnce({
      stdout: `FAIL ${testPath}\n✗ 1 failed`,
      stderr: '',
      exitCode: 1,
      durationMs: 100,
    })
  }

  it.each(['HEAD', 'main', 'friction/f3-no-number'])(
    'records evidence for the explicit task on branch %j with no task document',
    (branch) => {
      const dir = bareRepo()
      const testPath = '__tests__/explicit.test.ts'
      mockFailingRun(branch, testPath)

      const result = runTaskRecordRed({ testPath, dir, taskId: '#123' })

      expect(result.ok, result.ok ? '' : result.reason).toBe(true)
      const ev = JSON.parse(
        readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#123.json'), 'utf-8'),
      )
      expect(ev.task_id).toBe('#123')
    },
  )

  it('normalizes the explicit id (bare 123 → #123)', () => {
    const dir = bareRepo()
    const testPath = '__tests__/explicit.test.ts'
    mockFailingRun('HEAD', testPath)
    const result = runTaskRecordRed({ testPath, dir, taskId: '123' })
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#123.json'))).toBe(true)
  })

  it('still refuses with "no active task" when --task is absent', () => {
    const dir = bareRepo()
    mockBranch('HEAD')
    const result = runTaskRecordRed({ testPath: '__tests__/explicit.test.ts', dir })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no active task/i)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd'))).toBe(false)
  })

  it('still refuses an explicit id that contradicts a resolved branch task outside the chain', () => {
    const dir = bareRepo()
    mockBranch('task/#7-primary')
    const result = runTaskRecordRed({ testPath: '__tests__/explicit.test.ts', dir, taskId: '#9' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/not the active task/i)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#9.json'))).toBe(false)
  })

  it('still refuses when branch and task document disagree, even with --task naming one of them', () => {
    const dir = bareRepo()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', '.task-id'), '#489\n', 'utf-8')
    mockBranch('task/#503-gate-truth')
    const result = runTaskRecordRed({ testPath: '__tests__/explicit.test.ts', dir, taskId: '#503' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/mismatch/i)
  })
})

describe('record-red --at (#2747)', () => {
  const dirs: string[] = []

  beforeEach(() => mockedRunCli.mockReset())
  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
    mockedRunCli.mockReset()
  })

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'record-red-at-unit-'))
    dirs.push(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', '.task-id'), '#2747\n', 'utf-8')
    return dir
  }

  function mockAtRun(options: {
    atSha: string
    canonicalAtSha?: string
    headSha: string
    testExitCode: number
    testLog: string
    blobSha?: string
    ancestor?: boolean
    resolvesAt?: boolean
    prepareWorktree?: (worktree: string) => void
    inspectTestCwd?: (cwd: string) => void
  }): string[] {
    const worktrees: string[] = []
    mockedRunCli.mockImplementation((cmd, rawArgs, runOptions) => {
      const args = [...rawArgs]
      if (cmd === 'node' || cmd === 'npx' || cmd.endsWith('node_modules/.bin/vitest')) {
        options.inspectTestCwd?.(runOptions.cwd)
        return {
          stdout: options.testLog,
          stderr: '',
          exitCode: options.testExitCode,
          durationMs: 5,
        }
      }
      if (cmd !== 'git') throw new Error(`unexpected command: ${cmd}`)
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { stdout: 'main', stderr: '', exitCode: 0, durationMs: 5 }
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { stdout: options.headSha, stderr: '', exitCode: 0, durationMs: 5 }
      }
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        if (options.resolvesAt === false) throw new Error('unknown revision')
        return {
          stdout: options.canonicalAtSha ?? options.atSha,
          stderr: '',
          exitCode: 0,
          durationMs: 5,
        }
      }
      if (args[0] === 'merge-base') {
        return {
          stdout: '',
          stderr: '',
          exitCode: options.ancestor === false ? 1 : 0,
          durationMs: 5,
        }
      }
      if (args[0] === 'cat-file') {
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      }
      if (args[0] === 'status' || args[0] === 'add') {
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      }
      if (args[0] === 'worktree' && args[1] === 'add') {
        const worktree = String(args[3] === '--force' ? args[4] : args[3])
        mkdirSync(worktree, { recursive: true })
        options.prepareWorktree?.(worktree)
        worktrees.push(worktree)
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      }
      const selectedSha = options.canonicalAtSha ?? options.atSha
      if (args[0] === 'rev-parse' && String(args[1]).startsWith(`${selectedSha}:`)) {
        return {
          stdout: options.blobSha ?? 'c'.repeat(40),
          stderr: '',
          exitCode: 0,
          durationMs: 5,
        }
      }
      if (args[0] === 'ls-tree') {
        return { stdout: 'red.test.mjs\n', stderr: '', exitCode: 0, durationMs: 5 }
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`)
    })
    return worktrees
  }

  function recordAt(
    dir: string,
    atSha: string,
    testCmd?: readonly string[],
  ): ReturnType<typeof runTaskRecordRed> {
    const options = {
      testPath: 'red.test.mjs',
      dir,
      at: atSha,
      testCmd: testCmd ?? ['node', '--test', 'red.test.mjs'],
    }
    return runTaskRecordRed(options)
  }

  it('--at refuses a non-ancestor commit with exit 1', () => {
    const dir = repo()
    const atSha = 'a'.repeat(40)
    const worktrees = mockAtRun({
      atSha,
      headSha: 'b'.repeat(40),
      testExitCode: 1,
      testLog: '# fail 1',
      ancestor: false,
    })

    const result = recordAt(dir, atSha)

    expect(result.ok ? 0 : 1).toBe(1)
    expect(result.reason).toMatch(/not an ancestor/i)
    expect(worktrees).toHaveLength(0)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#2747.json'))).toBe(false)
  })

  it('--at refuses an unknown ref before creating a worktree or evidence', () => {
    const dir = repo()
    const worktrees = mockAtRun({
      atSha: 'missing',
      headSha: 'b'.repeat(40),
      testExitCode: 1,
      testLog: '# fail 1',
      resolvesAt: false,
    })

    const result = recordAt(dir, 'missing')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/cannot resolve --at commit missing/i)
    expect(worktrees).toHaveLength(0)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#2747.json'))).toBe(false)
  })

  it('--at refuses a test that passes at the selected commit', () => {
    const dir = repo()
    const atSha = 'a'.repeat(40)
    const worktrees = mockAtRun({
      atSha,
      headSha: 'b'.repeat(40),
      testExitCode: 0,
      testLog: '1..1\n# pass 1',
    })

    const result = recordAt(dir, atSha)

    expect(result.ok ? 0 : 1).toBe(1)
    expect(result.reason).toMatch(/exited 0.*suite passed.*RED phase/i)
    expect(worktrees).toHaveLength(1)
    expect(existsSync(worktrees[0])).toBe(false)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'tdd', '#2747.json'))).toBe(false)
  })

  it('--at records the selected commit and verifies its failing test', () => {
    const dir = repo()
    const atSha = 'a'.repeat(40)
    const blobSha = 'c'.repeat(40)
    const worktrees = mockAtRun({
      atSha,
      headSha: 'b'.repeat(40),
      testExitCode: 1,
      testLog: 'TAP version 13\n# fail 1',
      blobSha,
    })

    const record = recordAt(dir, atSha, ['node', '--test', 'red.test.mjs'])
    expect(record.ok, record.ok ? '' : record.reason).toBe(true)
    const evidence = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#2747.json'), 'utf-8'),
    ) as { test_commit_sha: string; test_blob_sha: string }
    expect(evidence.test_commit_sha).toBe(atSha)
    expect(evidence.test_blob_sha).toBe(blobSha)
    expect(worktrees).toHaveLength(1)
    expect(existsSync(worktrees[0])).toBe(false)

    const verification = runVerifyTdd({ taskId: '#2747', dir })
    expect(verification.status).toBe('PASS')
    expect(verification.exitCode).toBe(0)
    expect(worktrees).toHaveLength(2)
    expect(worktrees.every((worktree) => !existsSync(worktree))).toBe(true)
  })

  it('--at records an abbreviated ref as its canonical commit SHA', () => {
    const dir = repo()
    const atSha = 'abc1234'
    const canonicalAtSha = 'a'.repeat(40)
    mockAtRun({
      atSha,
      canonicalAtSha,
      headSha: 'b'.repeat(40),
      testExitCode: 1,
      testLog: 'TAP version 13\n# fail 1',
    })

    const record = recordAt(dir, atSha)

    expect(record.ok, record.ok ? '' : record.reason).toBe(true)
    const evidence = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#2747.json'), 'utf-8'),
    ) as { test_commit_sha: string; test_blob_sha: string }
    expect(evidence.test_commit_sha).toBe(canonicalAtSha)
    expect(evidence.test_blob_sha).toBe('c'.repeat(40))
  })

  it('--at resolves a relative repo directory before linking dependencies', () => {
    const dir = repo()
    mkdirSync(join(dir, 'node_modules'))
    const atSha = 'a'.repeat(40)
    let linkedSource = ''
    mockAtRun({
      atSha,
      headSha: 'b'.repeat(40),
      testExitCode: 1,
      testLog: 'TAP version 13\n# fail 1',
      inspectTestCwd(cwd) {
        const link = join(cwd, 'node_modules')
        expect(existsSync(link)).toBe(true)
        linkedSource = readlinkSync(link)
      },
    })

    const record = recordAt(relative(process.cwd(), dir), atSha)

    expect(record.ok, record.ok ? '' : record.reason).toBe(true)
    expect(isAbsolute(linkedSource)).toBe(true)
    expect(linkedSource).toBe(resolve(dir, 'node_modules'))
  })

  it('--at resolves package context and runner from the selected commit', () => {
    const dir = repo()
    const atSha = 'a'.repeat(40)
    const testPath = 'frontend/src/ConfirmDialog.test.ts'
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n')
    const worktrees = mockAtRun({
      atSha,
      headSha: 'b'.repeat(40),
      testExitCode: 1,
      testLog: 'FAIL src/ConfirmDialog.test.ts\n1 failed',
      prepareWorktree(worktree) {
        mkdirSync(join(worktree, 'frontend', 'src'), { recursive: true })
        writeFileSync(join(worktree, 'frontend', 'package.json'), '{"type":"module"}\n')
      },
    })

    const result = runTaskRecordRed({ testPath, dir, at: atSha })

    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    const testCall = mockedRunCli.mock.calls.find(([cmd]) => cmd === 'npx')
    expect(testCall?.[1]).toEqual(['vitest', 'run', 'src/ConfirmDialog.test.ts'])
    expect((testCall?.[2] as { cwd: string }).cwd).toBe(join(worktrees[0], 'frontend'))
    const evidence = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#2747.json'), 'utf-8'),
    )
    expect(evidence.test_cwd).toBe('frontend')
  })

  it('--at records and runs a root-hoisted package binary without an absolute checkout path', () => {
    const dir = repo()
    const atSha = 'a'.repeat(40)
    const testPath = 'frontend/src/ConfirmDialog.test.ts'
    mkdirSync(join(dir, 'frontend'), { recursive: true })
    writeFileSync(join(dir, 'frontend', 'package.json'), '{"type":"module"}\n')
    const absoluteVitest = join(dir, 'node_modules', '.bin', 'vitest')
    const worktrees = mockAtRun({
      atSha,
      headSha: 'b'.repeat(40),
      testExitCode: 1,
      testLog: 'FAIL src/ConfirmDialog.test.ts\n1 failed',
      prepareWorktree(worktree) {
        mkdirSync(join(worktree, 'frontend', 'src'), { recursive: true })
        writeFileSync(join(worktree, 'frontend', 'package.json'), '{"type":"module"}\n')
      },
    })

    const result = runTaskRecordRed({
      testPath,
      dir,
      at: atSha,
      testCmd: [absoluteVitest, 'run', 'src/ConfirmDialog.test.ts'],
    })

    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    const testCall = mockedRunCli.mock.calls.find(([cmd]) =>
      cmd.endsWith('node_modules/.bin/vitest'),
    )
    expect(testCall?.[0]).toBe('../node_modules/.bin/vitest')
    expect((testCall?.[2] as { cwd: string }).cwd).toBe(join(worktrees[0], 'frontend'))
    const evidence = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'evidence', 'tdd', '#2747.json'), 'utf-8'),
    )
    expect(evidence.test_command).toEqual([
      '../node_modules/.bin/vitest',
      'run',
      'src/ConfirmDialog.test.ts',
    ])
    expect(JSON.stringify(evidence)).not.toContain(dir)
  })
})
