// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  TddEvidenceV1,
  FAILURE_SIGNATURES,
  extractFailureSignature,
  loadTddEvidence,
  tddEvidencePath,
  writeTddEvidence,
  type TddEvidence,
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
  it('contains entries for vitest, jest, pytest, gradle, cargo, go and playwright (AC-2386.2)', () => {
    const frameworks = FAILURE_SIGNATURES.map((e) => e.framework)
    expect(frameworks).toContain('vitest')
    expect(frameworks).toContain('jest')
    expect(frameworks).toContain('pytest')
    expect(frameworks).toContain('gradle')
    expect(frameworks).toContain('cargo')
    expect(frameworks).toContain('go')
    expect(frameworks).toContain('playwright')
  })

  it('each entry has a non-null regex', () => {
    for (const entry of FAILURE_SIGNATURES) {
      expect(entry.pattern).toBeInstanceOf(RegExp)
    }
  })
})

describe('extractFailureSignature() — Playwright line/list reporter', () => {
  const failedRun = ['Running 3 tests using 1 worker', '', '  1 failed'].join('\n')

  it('recognises a non-zero failed summary as red evidence (AC-2386.1)', () => {
    expect(extractFailureSignature(failedRun)?.framework).toBe('playwright')
  })

  it('does not accept a zero failed summary as red evidence (AC-2386.3)', () => {
    expect(extractFailureSignature('Running 3 tests using 1 worker\n  0 failed')).toBeNull()
  })

  it('keeps the same signature in the emitted gate template (AC-2386.2)', () => {
    const template = readFileSync(
      resolve('src/templates/scripts/check-tdd-evidence.mjs.ejs'),
      'utf-8',
    )
    expect(template).toContain('/^\\s*[1-9]\\d* failed\\b/m')
  })
})

describe('extractFailureSignature()', () => {
  it('extracts a failing node:test TAP summary but rejects non-fatal TAP directives', () => {
    const failingTapLog = [
      'TAP version 13',
      'not ok 1 - parses invalid input',
      '  ---',
      '  error: expected failure',
      '  ...',
      '# tests 1',
      '# pass 0',
      '# fail 1',
    ].join('\n')
    expect(extractFailureSignature(failingTapLog)?.framework).toBe('tap')
    expect(extractFailureSignature('TAP version 13\n# tests 1\n# pass 1\n# fail 0')).toBeNull()
    expect(extractFailureSignature('not ok 1 - deferred test # TODO\n# fail 0')).toBeNull()
  })

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

  it('extracts vitest FAIL line even with ANSI SGR codes injected under CI=true (#1770-class)', () => {
    // Reproduces vitest 3.x's real CI output: it force-colours the summary line
    // even when stdout is piped, inserting escape codes between "FAIL" and the
    // test path.
    const log =
      '\x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m src/e2e-red.test.ts\x1b[2m > \x1b[22mx\x1b[2m > \x1b[22my'
    const result = extractFailureSignature(log)
    expect(result).not.toBeNull()
    expect(result!.framework).toBe('vitest')
    expect(result!.match).toBe('FAIL  src/e2e-red.test.ts')
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

describe('writeTddEvidence() (#2064)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'tdd-write-test-'))
    dirs.push(d)
    return d
  }

  function evidence(overrides: Partial<TddEvidence> = {}): TddEvidence {
    return { ...VALID, ...overrides } as TddEvidence
  }

  it('writes evidence for a task with no prior evidence file', () => {
    const dir = tmpRepo()
    const p = writeTddEvidence({ repoDir: dir, evidence: evidence() })
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(true)
    expect(p).toBe(tddEvidencePath('#551', dir))
  })

  it('overwrites a prior evidence file belonging to the SAME task (re-recording)', () => {
    const dir = tmpRepo()
    writeTddEvidence({ repoDir: dir, evidence: evidence({ observed_failure: 'first run' }) })
    writeTddEvidence({ repoDir: dir, evidence: evidence({ observed_failure: 'second run' }) })
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.observed_failure).toBe('second run')
  })

  // Test case 6 (#2064): evidence path exists with mismatched internal task_id => fail closed.
  it('refuses to overwrite a file whose on-disk task_id differs from its own path (fail closed)', () => {
    const dir = tmpRepo()
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    // A corrupted/hand-edited file: filename says #551, content says #999.
    const tampered = { ...VALID, task_id: '#999' }
    const p = tddEvidencePath('#551', dir)
    writeFileSync(p, JSON.stringify(tampered), 'utf-8')

    expect(() =>
      writeTddEvidence({ repoDir: dir, evidence: evidence({ task_id: '#551' }) }),
    ).toThrow(/refusing to overwrite/)
    // No file changes (#2064 expected resolution item 3).
    expect(readFileSync(p, 'utf-8')).toBe(JSON.stringify(tampered))
  })

  // Test case 5 (#2064): interrupted write => prior evidence remains valid.
  it('leaves prior evidence intact when the atomic write is interrupted', () => {
    // Skip where the process runs as root (root ignores directory permissions) —
    // same convention as __tests__/utils/safe-read.test.ts.
    if (process.getuid?.() === 0) return
    const dir = tmpRepo()
    writeTddEvidence({ repoDir: dir, evidence: evidence({ observed_failure: 'original' }) })
    const p = tddEvidencePath('#551', dir)
    const before = readFileSync(p, 'utf-8')

    // Read+execute only: the atomic writer can no longer create its temp-file
    // sibling (or rename it in), so the write is interrupted before it can
    // touch the existing evidence file.
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    chmodSync(evDir, 0o555)
    try {
      expect(() =>
        writeTddEvidence({ repoDir: dir, evidence: evidence({ observed_failure: 'new run' }) }),
      ).toThrow()
    } finally {
      chmodSync(evDir, 0o755)
    }

    // The temp-file + rename primitive never touched the original path.
    expect(readFileSync(p, 'utf-8')).toBe(before)
  })

  it('rejects evidence that fails schema validation before writing anything', () => {
    const dir = tmpRepo()
    expect(() =>
      writeTddEvidence({ repoDir: dir, evidence: evidence({ task_id: 'not-a-task-id' }) }),
    ).toThrow()
    expect(loadTddEvidence('not-a-task-id', dir).ok).toBe(false)
  })

  // #2533: `writeFile` refuses to overwrite any file whose bytes contain the literal
  // `arbiter:preserve` (src/utils/fs.ts #1980), anywhere in the body. A captured
  // `test_run_log` that happens to quote AGENTS.md's own `<!-- arbiter:preserve -->`
  // comment (ordinary content in a governance repo) must not permanently freeze the
  // evidence file while `record-red` keeps reporting OK.
  it('rewrites an evidence file whose on-disk content carries the arbiter:preserve marker (#2533)', () => {
    const dir = tmpRepo()
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    const p = tddEvidencePath('#551', dir)
    const priorWithMarker = evidence({
      test_run_log:
        'FAIL x\nquoted from AGENTS.md: <!-- arbiter:preserve -->\nsome governance text',
      observed_failure: 'first run',
    })
    writeFileSync(p, JSON.stringify(priorWithMarker, null, 2) + '\n', 'utf-8')

    // A subsequent record-red must still be able to rewrite the evidence file — the
    // marker in the OLD content must never freeze it.
    writeTddEvidence({ repoDir: dir, evidence: evidence({ observed_failure: 'second run' }) })
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.observed_failure).toBe('second run')
  })

  it('rewrites an evidence file even when the NEW test_run_log itself quotes the marker (#2533)', () => {
    const dir = tmpRepo()
    writeTddEvidence({ repoDir: dir, evidence: evidence({ observed_failure: 'first run' }) })
    writeTddEvidence({
      repoDir: dir,
      evidence: evidence({
        observed_failure: 'second run',
        test_run_log: 'diff shows AGENTS.md content: <!-- arbiter:preserve -->',
      }),
    })
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.observed_failure).toBe('second run')
      expect(result.data.test_run_log).toContain('arbiter:preserve')
    }
  })

  it('is a no-op (does not throw) re-recording byte-identical evidence (benign skip)', () => {
    const dir = tmpRepo()
    const same = evidence({ observed_failure: 'stable run' })
    writeTddEvidence({ repoDir: dir, evidence: same })
    expect(() => writeTddEvidence({ repoDir: dir, evidence: same })).not.toThrow()
    const result = loadTddEvidence('#551', dir)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.observed_failure).toBe('stable run')
  })
})

describe('tddEvidencePath()', () => {
  it('returns canonical path for a task id', () => {
    const p = tddEvidencePath('#551', '/repo')
    expect(p).toBe('/repo/.arbiter/evidence/tdd/#551.json')
  })
})
