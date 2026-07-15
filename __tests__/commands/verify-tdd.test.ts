// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { runVerifyTdd } from '../../src/commands/verify-tdd.js'

vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
}))

// The red-execution check (#1957) spawns real git worktrees + subprocesses —
// out of scope for these orchestration-level unit tests, which only assert
// that runVerifyTdd wires each check's result into the report correctly.
// Real, unmocked reproduction lives in
// __tests__/integration/gate/tdd-red-execution-gap.test.ts.
vi.mock('../../src/evidence/tdd-reexecute.js', () => ({
  verifyRedExecution: vi.fn().mockReturnValue({ ok: true }),
}))

import { verifyRedExecution } from '../../src/evidence/tdd-reexecute.js'
const mockedVerifyRedExecution = vi.mocked(verifyRedExecution)

const VALID_EVIDENCE = {
  $schemaVersion: 1,
  task_id: '#551',
  test_path: '__tests__/evidence/tdd.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 test failed',
  observed_failure: 'FAIL __tests__/evidence/tdd.test.ts',
  recorded_at: '2026-05-16T00:00:00.000Z',
  test_command: ['npx', 'vitest', 'run', '__tests__/evidence/tdd.test.ts'],
}

describe('runVerifyTdd()', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
    mockedVerifyRedExecution.mockClear()
    mockedVerifyRedExecution.mockReturnValue({ ok: true })
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'verify-tdd-test-'))
    dirs.push(d)
    return d
  }

  function writeEvidence(dir: string, evidence: Record<string, unknown>): void {
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, '#551.json'), JSON.stringify(evidence), 'utf-8')
  }

  it('returns status PASS when evidence is valid and all checks pass', () => {
    const dir = tmpRepo()
    writeEvidence(dir, VALID_EVIDENCE)
    const result = runVerifyTdd({ taskId: '#551', dir })
    expect(result.status).toBe('PASS')
    expect(result.exitCode).toBe(0)
  })

  it('returns status FAIL when evidence file is missing', () => {
    const dir = tmpRepo()
    const result = runVerifyTdd({ taskId: '#551', dir })
    expect(result.status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
    expect(result.reason).toMatch(/not found/)
  })

  it('returns status FAIL when schema is invalid', () => {
    const dir = tmpRepo()
    writeEvidence(dir, { bad: true })
    const result = runVerifyTdd({ taskId: '#551', dir })
    expect(result.status).toBe('FAIL')
    expect(result.reason).toMatch(/schema/)
  })

  it('returns status FAIL when task_id in evidence does not match requested taskId', () => {
    const dir = tmpRepo()
    writeEvidence(dir, { ...VALID_EVIDENCE, task_id: '#999' })
    const result = runVerifyTdd({ taskId: '#551', dir })
    expect(result.status).toBe('FAIL')
    expect(result.reason).toMatch(/task_id mismatch/)
  })

  it('returns status FAIL when no failure signature in log', () => {
    const dir = tmpRepo()
    writeEvidence(dir, { ...VALID_EVIDENCE, test_run_log: 'All passed.', observed_failure: 'x' })
    const result = runVerifyTdd({ taskId: '#551', dir })
    expect(result.status).toBe('FAIL')
    expect(result.reason).toMatch(/failure signature/)
  })

  it('returns exitCode 0 for PASS and 1 for FAIL', () => {
    const dir = tmpRepo()
    const fail = runVerifyTdd({ taskId: '#551', dir })
    expect(fail.exitCode).toBe(1)
    writeEvidence(dir, VALID_EVIDENCE)
    const pass = runVerifyTdd({ taskId: '#551', dir })
    expect(pass.exitCode).toBe(0)
  })

  it('--json: includes status, reason, checks in result', () => {
    const dir = tmpRepo()
    writeEvidence(dir, VALID_EVIDENCE)
    const result = runVerifyTdd({ taskId: '#551', dir, json: true })
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('checks')
    expect(Array.isArray(result.checks)).toBe(true)
  })

  it('PASS report lists all checks as passed', () => {
    const dir = tmpRepo()
    writeEvidence(dir, VALID_EVIDENCE)
    const result = runVerifyTdd({ taskId: '#551', dir, json: true })
    for (const check of result.checks ?? []) {
      expect(check.pass).toBe(true)
    }
  })

  it('runs 6 checks including red-execution, in order, when evidence is valid (#1957)', () => {
    const dir = tmpRepo()
    writeEvidence(dir, VALID_EVIDENCE)
    const result = runVerifyTdd({ taskId: '#551', dir, json: true })
    expect(result.checks?.map((c) => c.name)).toEqual([
      'evidence-file',
      'task-id-match',
      'failure-signature',
      'sha-on-branch',
      'test-path-in-commit',
      'red-execution',
    ])
  })

  it('returns status FAIL when red-execution reports the recorded failure did not reproduce (#1957)', () => {
    const dir = tmpRepo()
    writeEvidence(dir, VALID_EVIDENCE)
    mockedVerifyRedExecution.mockReturnValueOnce({
      ok: false,
      reason: 'test_command did not fail when re-run at test_commit_sha — false-green risk',
    })
    const result = runVerifyTdd({ taskId: '#551', dir })
    expect(result.status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
    expect(result.reason).toMatch(/false-green risk/)
    const reExecCheck = result.checks?.find((c) => c.name === 'red-execution')
    expect(reExecCheck?.pass).toBe(false)
  })
})
