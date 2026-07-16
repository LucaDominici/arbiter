// SPDX-License-Identifier: Apache-2.0
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { verifyRedExecution } from '../../src/evidence/tdd-reexecute.js'
import type { TddEvidence } from '../../src/evidence/tdd.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    stdout = ''
    stderr = ''
  },
}))

import { runCli, CliError } from '../../src/utils/run-cli.js'
const mockedRunCli = vi.mocked(runCli)

/**
 * Build an instance of the MOCKED CliError above (a bare Error subclass with
 * writable stdout/stderr) carrying the child-process output under test. Typed
 * against the real class, whose ctor signature/readonly fields do not apply to
 * the mock at runtime — the casts below bridge that gap in one place.
 */
function cliError(fields: { stdout?: string; stderr?: string } = {}): CliError {
  const MockedCtor = CliError as unknown as new () => CliError
  return Object.assign(new MockedCtor(), fields)
}

const BASE: TddEvidence = {
  $schemaVersion: 1,
  task_id: '#9001',
  test_path: 'math.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL math.test.ts\n1 test failed',
  observed_failure: 'FAIL math.test.ts',
  recorded_at: '2026-07-15T00:00:00.000Z',
  test_command: ['npx', 'vitest', 'run', 'math.test.ts'],
}

describe('verifyRedExecution()', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when evidence has no test_command (legacy, pre-#1957)', () => {
    const { test_command, ...legacy } = BASE
    void test_command
    const result = verifyRedExecution(legacy, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/test_command/)
    expect(mockedRunCli).not.toHaveBeenCalled()
  })

  it('fails closed when test_command is an empty array', () => {
    const result = verifyRedExecution({ ...BASE, test_command: [] }, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/test_command/)
  })

  it('fails when the isolated worktree checkout fails', () => {
    mockedRunCli
      .mockReturnValueOnce({
        stdout: '',
        stderr: 'fatal: bad revision',
        exitCode: 128,
        durationMs: 5,
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/check out test_commit_sha/)
  })

  it('fails when the worktree add throws', () => {
    mockedRunCli
      .mockImplementationOnce(() => {
        throw cliError()
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/check out test_commit_sha/)
  })

  it('fails when the re-run at test_commit_sha did not reproduce any failure (the false-green case)', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockReturnValueOnce({
        stdout: 'All tests passed.\n5 tests',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      }) // test run
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/did not fail when re-run/)
    expect(result.reason).toMatch(/false-green risk/)
  })

  it('fails when the re-run failure does not match the recorded observed_failure', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'FAIL other.test.ts\n1 test failed' })
      }) // test run — non-zero exit throws
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not the recorded observed_failure/)
  })

  it('passes when the re-run reproduces the recorded observed_failure exactly', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
      }) // test run — genuinely red, non-zero exit
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(true)
  })

  it('always attempts worktree cleanup, even when the check fails', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockReturnValueOnce({ stdout: 'All good.', stderr: '', exitCode: 0, durationMs: 5 }) // test run (no failure)
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    verifyRedExecution(BASE, '/repo')
    const removeCall = mockedRunCli.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('remove'),
    )
    expect(removeCall).toBeDefined()
  })

  it('surfaces the CliError stderr detail when the worktree add throws with stderr', () => {
    mockedRunCli
      .mockImplementationOnce(() => {
        throw cliError({ stderr: 'fatal: reference is not a tree' })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/fatal: reference is not a tree/)
  })

  it('surfaces a non-CliError thrown by the worktree add as a checkout failure', () => {
    mockedRunCli
      .mockImplementationOnce(() => {
        throw new Error('spawn git ENOENT')
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/check out test_commit_sha/)
    expect(result.reason).toMatch(/spawn git ENOENT/)
  })

  it('fails closed when the test run throws a non-CliError (no output to match)', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw new Error('runner crashed before producing output')
      }) // test run
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/did not fail when re-run/)
    expect(result.reason).toMatch(/false-green risk/)
  })

  it('reproduces the failure when the signature appears only on the failing run stderr', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'running suite…', stderr: 'FAIL math.test.ts\n1 test failed' })
      }) // test run — failure reported on stderr
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(true)
  })

  it('honours a failure signature on stderr even when the runner exits 0', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockReturnValueOnce({
        stdout: 'suite started',
        stderr: 'FAIL math.test.ts\n1 test failed',
        exitCode: 0,
        durationMs: 50,
      }) // test run — zero exit, failure only visible on stderr
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(true)
  })

  it('links the caller node_modules into the worktree so the re-run resolves its runner', () => {
    const callerDir = mkdtempSync(join(tmpdir(), 'tdd-reexec-caller-'))
    mkdirSync(join(callerDir, 'node_modules'))
    let seenLinkTarget: string | undefined
    try {
      mockedRunCli
        .mockImplementationOnce((_cmd, args) => {
          // `git worktree add` genuinely creates the target directory.
          mkdirSync(String((args as readonly string[])[4]), { recursive: true })
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
        })
        .mockImplementationOnce((_cmd, _args, opts) => {
          // The re-run must see node_modules linked inside its own cwd.
          const linkPath = join(String((opts as { cwd: string }).cwd), 'node_modules')
          if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
            seenLinkTarget = readlinkSync(linkPath)
          }
          throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
        })
        .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
      const result = verifyRedExecution(BASE, callerDir)
      expect(result.ok).toBe(true)
      expect(seenLinkTarget).toBe(join(callerDir, 'node_modules'))
    } finally {
      rmSync(callerDir, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd() when no dir is given and fails open on an impossible symlink', () => {
    // gitCwd() lets ARBITER_HOOK_GIT_CWD win (pre-push rsync dir has no .git);
    // isolate the fallback-under-test from that override.
    const savedHookGitCwd = process.env.ARBITER_HOOK_GIT_CWD
    delete process.env.ARBITER_HOOK_GIT_CWD
    try {
      mockedRunCli
        // worktree add "succeeds" but never creates the directory, so the
        // node_modules symlink attempt below throws — FAIL-OPEN-INTENT path.
        .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
        .mockReturnValueOnce({
          stdout: 'All tests passed.',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
        })
        .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
      const result = verifyRedExecution(BASE)
      // The symlink failure did not mask the real outcome: the re-run passed,
      // so the check still fails closed on the unreproduced RED phase.
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/did not fail when re-run/)
      // The repo was resolved from process.cwd(), not from an explicit dir.
      const addCall = mockedRunCli.mock.calls[0]
      expect((addCall[2] as { cwd: string }).cwd).toBe(process.cwd())
    } finally {
      if (savedHookGitCwd !== undefined) process.env.ARBITER_HOOK_GIT_CWD = savedHookGitCwd
    }
  })

  it('still returns the check result when worktree removal itself throws (fail-open cleanup)', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
      }) // test run — genuinely red
      .mockImplementationOnce(() => {
        throw new Error('worktree remove: lock held')
      }) // cleanup blows up
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(true)
  })
})
