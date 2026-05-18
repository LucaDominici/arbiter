// SPDX-License-Identifier: Apache-2.0
// Tests for #549: legacy 'implementation' phase migration → 'red'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runTaskAdvance, runTaskResume } from '../../src/commands/task.js'

// Stub git SHA check — migration tests don't exercise a real repo
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
}))

vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({
    modelSwitch: false,
    transcriptPath: null,
    exitPlanModeTool: false,
  }),
}))

const VALID_EVIDENCE = {
  $schemaVersion: 1,
  task_id: '#549',
  test_path: '__tests__/commands/task-phase-migration.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL __tests__/commands/task-phase-migration.test.ts\n✗ 1 test failed',
  observed_failure: 'FAIL __tests__/commands/task-phase-migration.test.ts',
  recorded_at: '2026-05-16T00:00:00.000Z',
}

function writeEvidence(dir: string): void {
  const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(join(evDir, '#549.json'), JSON.stringify(VALID_EVIDENCE), 'utf-8')
}

describe('legacy implementation phase migration (#549)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', '.task-id'), '#549\n', 'utf-8')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('legacy implementation on disk: advance to green succeeds (migrated to red)', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'implementation\n')
    writeEvidence(dir)
    // If migration works: disk 'implementation' → read as 'red'; 'green' is next after 'red' → should succeed
    expect(() => runTaskAdvance({ to: 'green', dir })).not.toThrow()
    const phase = readFileSync(join(dir, '.claude', '.task-phase'), 'utf-8').trim()
    expect(phase).toBe('green')
  })

  it('legacy implementation on disk: phase file rewritten to red (migration is idempotent)', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'implementation\n')
    // trigger migration via resume (read-only path)
    let out = ''
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s: string | Uint8Array) => {
      out += typeof s === 'string' ? s : ''
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = orig
    }
    void out
    // disk must now say 'red', not 'implementation'
    const phase = readFileSync(join(dir, '.claude', '.task-phase'), 'utf-8').trim()
    expect(phase).toBe('red')
    // second read should NOT append another history line
    process.stdout.write = (s: string | Uint8Array) => {
      out += typeof s === 'string' ? s : ''
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = orig
    }
    const history = readFileSync(join(dir, '.claude', '.task-phase-history'), 'utf-8')
    const lines = history.split('\n').filter((l) => l.includes('auto-migrated'))
    expect(lines).toHaveLength(1)
  })

  it('legacy implementation on disk: history records migration audit line', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'implementation\n')
    writeEvidence(dir)
    runTaskAdvance({ to: 'green', dir })
    const history = readFileSync(join(dir, '.claude', '.task-phase-history'), 'utf-8')
    expect(history).toContain('implementation → red [auto-migrated]')
  })

  it('legacy implementation on disk: resume shows red phase recovery', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'implementation\n')
    let output = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s: string | Uint8Array) => {
      output += typeof s === 'string' ? s : ''
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = origWrite
    }
    expect(output).toContain('red')
  })

  it('--to implementation rejected as invalid phase', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'plan\n')
    expect(() => runTaskAdvance({ to: 'implementation' as never, dir })).toThrow(
      /invalid.*to|unknown.*phase/i,
    )
  })

  it('red → green → refactor sequence succeeds', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'red-team-review\n')
    writeEvidence(dir)
    runTaskAdvance({ to: 'red', dir })
    runTaskAdvance({ to: 'green', dir })
    runTaskAdvance({ to: 'refactor', dir })
    const phase = readFileSync(join(dir, '.claude', '.task-phase'), 'utf-8').trim()
    expect(phase).toBe('refactor')
  })

  it('refactor → verification succeeds', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'refactor\n')
    expect(() => runTaskAdvance({ to: 'verification', dir })).not.toThrow()
  })

  it('plan-review gate triggers on --to red (not implementation)', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'red-team-review\n')
    // skipPlanReview bypasses gate — verify advance works
    expect(() => runTaskAdvance({ to: 'red', dir, skipPlanReview: true })).not.toThrow()
  })
})
