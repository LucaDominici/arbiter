// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  TddEvidenceV1,
  FAILURE_SIGNATURES,
  extractFailureSignature,
  loadTddEvidence,
  tddEvidencePath,
} from '../../src/evidence/tdd.js'

const VALID: Record<string, unknown> = {
  $schemaVersion: 1,
  task_id: '#551',
  test_path: '__tests__/evidence/tdd.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL __tests__/evidence/tdd.test.ts\n✗ 1 test failed',
  observed_failure: 'FAIL __tests__/evidence/tdd.test.ts',
  recorded_at: '2026-05-16T00:00:00.000Z',
}

describe('TddEvidenceV1 schema', () => {
  it('accepts a valid evidence object', () => {
    expect(TddEvidenceV1.safeParse(VALID).success).toBe(true)
  })

  it('rejects missing task_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { task_id, ...rest } = VALID
    expect(TddEvidenceV1.safeParse(rest).success).toBe(false)
  })

  it('rejects task_id without # prefix', () => {
    expect(TddEvidenceV1.safeParse({ ...VALID, task_id: '551' }).success).toBe(false)
  })

  it('rejects test_commit_sha shorter than 40 chars', () => {
    expect(TddEvidenceV1.safeParse({ ...VALID, test_commit_sha: 'abc123' }).success).toBe(false)
  })

  it('rejects test_commit_sha longer than 40 chars', () => {
    expect(TddEvidenceV1.safeParse({ ...VALID, test_commit_sha: 'a'.repeat(41) }).success).toBe(
      false,
    )
  })

  it('rejects invalid recorded_at (not ISO8601)', () => {
    expect(TddEvidenceV1.safeParse({ ...VALID, recorded_at: 'not-a-date' }).success).toBe(false)
  })

  it('rejects schemaVersion != 1', () => {
    expect(TddEvidenceV1.safeParse({ ...VALID, $schemaVersion: 2 }).success).toBe(false)
  })

  it('rejects empty observed_failure', () => {
    expect(TddEvidenceV1.safeParse({ ...VALID, observed_failure: '' }).success).toBe(false)
  })
})

describe('FAILURE_SIGNATURES registry', () => {
  it('contains entries for vitest, jest, pytest, gradle, cargo, go', () => {
    const frameworks = FAILURE_SIGNATURES.map((e) => e.framework)
    expect(frameworks).toContain('vitest')
    expect(frameworks).toContain('jest')
    expect(frameworks).toContain('pytest')
    expect(frameworks).toContain('gradle')
    expect(frameworks).toContain('cargo')
    expect(frameworks).toContain('go')
  })

  it('each entry has a non-null regex', () => {
    for (const entry of FAILURE_SIGNATURES) {
      expect(entry.pattern).toBeInstanceOf(RegExp)
    }
  })
})

describe('extractFailureSignature()', () => {
  it('extracts vitest FAIL line', () => {
    const log = 'FAIL __tests__/evidence/tdd.test.ts\n  Error: expected 1 to be 2'
    const result = extractFailureSignature(log)
    expect(result).not.toBeNull()
    expect(result!.framework).toBe('vitest')
  })

  it('extracts jest FAIL line', () => {
    const log = '  ● test suite failed to run\nFAIL src/foo.test.ts'
    const result = extractFailureSignature(log)
    expect(result).not.toBeNull()
  })

  it('extracts pytest FAILURES block', () => {
    const log = '============================= FAILURES ============================='
    expect(extractFailureSignature(log)).not.toBeNull()
  })

  it('extracts cargo test result: FAILED', () => {
    const log = 'test result: FAILED. 0 passed; 1 failed'
    expect(extractFailureSignature(log)?.framework).toBe('cargo')
  })

  it('extracts go --- FAIL:', () => {
    const log = '--- FAIL: TestFoo (0.00s)'
    expect(extractFailureSignature(log)?.framework).toBe('go')
  })

  it('returns null when log shows passing tests', () => {
    expect(extractFailureSignature('All tests passed.\n✓ 10 tests')).toBeNull()
  })
})

describe('loadTddEvidence()', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'tdd-evidence-test-'))
    dirs.push(d)
    return d
  }

  it('returns ok:false when evidence file is missing', () => {
    const dir = tmpRepo()
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not found/)
  })

  it('returns ok:false when file contains invalid JSON', () => {
    const dir = tmpRepo()
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, '#551.json'), 'not json', 'utf-8')
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/invalid JSON/)
  })

  it('returns ok:false when schema validation fails', () => {
    const dir = tmpRepo()
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, '#551.json'), JSON.stringify({ bad: true }), 'utf-8')
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/schema/)
  })

  it('returns ok:true with parsed evidence for a valid file', () => {
    const dir = tmpRepo()
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, '#551.json'), JSON.stringify(VALID), 'utf-8')
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.task_id).toBe('#551')
  })
})

describe('tddEvidencePath()', () => {
  it('returns canonical path for a task id', () => {
    const p = tddEvidencePath('#551', '/repo')
    expect(p).toBe('/repo/.arbiter/evidence/tdd/#551.json')
  })
})
