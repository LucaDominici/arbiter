// SPDX-License-Identifier: Apache-2.0
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
        throw new CliError()
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
        const err = new CliError()
        err.stdout = 'FAIL other.test.ts\n1 test failed'
        throw err
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
        const err = new CliError()
        err.stdout = 'FAIL math.test.ts\n1 test failed'
        throw err
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
})
