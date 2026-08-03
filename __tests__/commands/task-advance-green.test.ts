// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { runTaskAdvance } from '../../src/commands/task.js'

// Stub git sha check so tests don't need a real repo
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  resolveEvidenceCommit: vi.fn((ev: { test_commit_sha: string }) => ({
    sha: ev.test_commit_sha,
    healed: false,
  })),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
}))

const VALID_EVIDENCE = {
  $schemaVersion: 1,
  task_id: '#551',
  test_path: '__tests__/evidence/tdd.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 test failed',
  observed_failure: 'FAIL __tests__/evidence/tdd.test.ts',
  recorded_at: '2026-05-16T00:00:00.000Z',
}

describe('task advance --to green: TDD evidence gate', () => {
  const dirs: string[] = []
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'task-green-test-'))
    dirs.push(d)
    // Set up .claude phase = implementation so advance to green is legal
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeFileSync(join(d, '.claude', '.task-id'), '#551\n', 'utf-8')
    writeFileSync(join(d, '.claude', '.task-phase'), 'implementation\n', 'utf-8')
    return d
  }

  function writeEvidence(dir: string, evidence: Record<string, unknown>): void {
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, '#551.json'), JSON.stringify(evidence), 'utf-8')
  }

  it('advances to green when valid evidence file exists', () => {
    const dir = tmpRepo()
    writeEvidence(dir, VALID_EVIDENCE)
    expect(() => runTaskAdvance({ to: 'green', dir })).not.toThrow()
  })

  it('throws when evidence file is missing', () => {
    const dir = tmpRepo()
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/TDD evidence/)
  })

  it('throws when evidence file has invalid schema (bad sha length)', () => {
    const dir = tmpRepo()
    writeEvidence(dir, { ...VALID_EVIDENCE, test_commit_sha: 'abc' })
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/schema|40/)
  })

  it('throws when task_id in evidence does not match active task', () => {
    const dir = tmpRepo()
    writeEvidence(dir, { ...VALID_EVIDENCE, task_id: '#999' })
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/task_id|mismatch/)
  })

  it('throws when test_run_log has no failure signature', () => {
    const dir = tmpRepo()
    writeEvidence(dir, {
      ...VALID_EVIDENCE,
      test_run_log: 'All tests passed.',
      observed_failure: 'All tests passed.',
    })
    expect(() => runTaskAdvance({ to: 'green', dir })).toThrow(/failure signature/)
  })

  it('"green" is a recognised phase (no "Invalid --to value" error)', () => {
    const dir = tmpRepo()
    writeEvidence(dir, VALID_EVIDENCE)
    // Should throw evidence error, not phase-invalid error
    const dir2 = tmpRepo()
    let err: Error | undefined
    try {
      runTaskAdvance({ to: 'green', dir: dir2 })
    } catch (e) {
      err = e as Error
    }
    expect(err?.message).not.toMatch(/Invalid --to value/)
  })
})
