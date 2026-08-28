// SPDX-License-Identifier: Apache-2.0
// Legacy → unified migration (#1206) + the historical 'implementation' → 'red' alias (#549).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, writeGatePassEvidence } from '../helpers.js'
import { runTaskAdvance, runTaskResume } from '../../src/commands/task.js'
import { readUnifiedState } from '../../src/commands/task-state.js'

// Stub git SHA check — migration tests don't exercise a real repo
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  resolveEvidenceCommit: vi.fn((ev: { test_commit_sha: string }) => ({
    sha: ev.test_commit_sha,
    healed: false,
  })),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
  currentBranch: vi.fn().mockReturnValue('task/549-phase-marker'),
  headSha: vi.fn().mockReturnValue('b'.repeat(40)),
}))

vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({
    modelSwitch: false,
    transcriptPath: null,
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

/**
 * #2328: the marker gate now verifies tree, checkout, toolchain, level and age
 * against a REAL checkout, so these cases need a real repo. The marker is built
 * by the writer and one field is planted on top.
 */
function initGitRepo(dir: string): void {
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git(['init', '-q', '-b', 'task/549-phase-marker'])
  git(['config', 'user.email', 'test@arbiter.dev'])
  git(['config', 'user.name', 'test-user'])
  // Mirrors arbiter's own .gitignore: task/gate runtime state is not tree content.
  writeFileSync(join(dir, '.gitignore'), '.arbiter/\n.claude/.task/\n.claude/.task-*\n', 'utf-8')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'fixture', '--no-gpg-sign'])
}

function writeGatePassMarker(dir: string, overrides: Record<string, unknown> = {}): void {
  writeGatePassEvidence(dir, { taskId: '#549', overrides })
}

function captureStdout(fn: () => void): string {
  let out = ''
  const orig = process.stdout.write.bind(process.stdout)
  // @ts-expect-error overriding the readonly stdout.write overload for a test capture shim
  process.stdout.write = (s: string | Uint8Array) => {
    out += typeof s === 'string' ? s : ''
    return true
  }
  try {
    fn()
  } finally {
    process.stdout.write = orig
  }
  return out
}

describe('legacy → unified migration (#1206, #549)', () => {
  let dir: string
  const seedLegacy = (phase: string) => {
    writeFileSync(join(dir, '.claude', '.task-id'), '#549\n', 'utf-8')
    writeFileSync(join(dir, '.claude', '.task-phase'), `${phase}\n`, 'utf-8')
  }
  const phaseOf = () => readUnifiedState(dir)?.phase

  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('legacy implementation on disk migrates to red; advance to green succeeds', () => {
    seedLegacy('implementation')
    writeEvidence(dir)
    expect(() => runTaskAdvance({ to: 'green', dir })).not.toThrow()
    expect(phaseOf()).toBe('green')
  })

  it('migration deletes legacy dotfiles and seeds the unified document at red', () => {
    seedLegacy('implementation')
    // any read triggers migration
    expect(phaseOf()).toBe('red')
    expect(existsSync(join(dir, '.claude', '.task-phase'))).toBe(false)
    expect(existsSync(join(dir, '.claude', '.task-id'))).toBe(false)
    expect(existsSync(join(dir, '.claude', '.task', 'status.json'))).toBe(true)
    expect(readUnifiedState(dir)?.taskId).toBe('#549')
  })

  it('legacy implementation on disk: resume shows red phase recovery', () => {
    seedLegacy('implementation')
    const out = captureStdout(() => runTaskResume({ dir }))
    expect(out).toContain('red')
  })

  it('--to implementation rejected as invalid phase', () => {
    seedLegacy('plan')
    expect(() => runTaskAdvance({ to: 'implementation' as never, dir })).toThrow(
      /invalid.*to|unknown.*phase/i,
    )
  })

  it('red-team-review → red → green → refactor sequence succeeds from legacy seed', () => {
    seedLegacy('red-team-review')
    writeEvidence(dir)
    runTaskAdvance({ to: 'red', dir })
    runTaskAdvance({ to: 'green', dir })
    runTaskAdvance({ to: 'refactor', dir })
    expect(phaseOf()).toBe('refactor')
  })

  it('refactor → verification enters the phase before its gate marker exists', () => {
    seedLegacy('refactor')
    expect(() => runTaskAdvance({ to: 'verification', dir })).not.toThrow()
    expect(phaseOf()).toBe('verification')
  })

  it('verification → close rejects a corrupt gate-pass marker', () => {
    seedLegacy('verification')
    const markerDir = join(dir, '.arbiter')
    mkdirSync(markerDir, { recursive: true })
    writeFileSync(join(markerDir, 'gate-pass.json'), '{not-json', 'utf-8')
    expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(
      /corrupt.*node scripts\/check-all\.mjs L1/i,
    )
    expect(phaseOf()).toBe('verification')
  })

  it.each(['null', '[]', '"a stale marker"'])(
    'verification → close rejects a non-object marker: %s',
    (marker) => {
      seedLegacy('verification')
      const markerDir = join(dir, '.arbiter')
      mkdirSync(markerDir, { recursive: true })
      writeFileSync(join(markerDir, 'gate-pass.json'), marker, 'utf-8')

      expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/marker must be a JSON object/i)
      expect(phaseOf()).toBe('verification')
    },
  )

  it('verification → close rejects a stale head_sha marker', () => {
    initGitRepo(dir)
    seedLegacy('verification')
    writeGatePassMarker(dir, { head_sha: 'a'.repeat(40) })
    expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/head_sha/i)
    expect(phaseOf()).toBe('verification')
  })

  it('verification → close rejects a marker for another branch', () => {
    initGitRepo(dir)
    seedLegacy('verification')
    writeGatePassMarker(dir, { branch: 'task/other-branch' })
    expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/branch/i)
    expect(phaseOf()).toBe('verification')
  })

  it('verification → close rejects a marker recorded over a dirty tree', () => {
    initGitRepo(dir)
    seedLegacy('verification')
    writeGatePassMarker(dir, { tree_was_clean_at_run_time: false })
    expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/tree_was_clean_at_run_time/i)
    expect(phaseOf()).toBe('verification')
  })

  it('verification → close accepts a fresh correlated marker and writes the phase', () => {
    initGitRepo(dir)
    seedLegacy('verification')
    writeGatePassMarker(dir)
    expect(() => runTaskAdvance({ to: 'close', dir })).not.toThrow()
    expect(phaseOf()).toBe('close')
  })

  it('verification → close accepts the fast L1 marker, but complete still requires L2', () => {
    initGitRepo(dir)
    seedLegacy('verification')
    writeGatePassEvidence(dir, { taskId: '#549', level: 'L1' })

    expect(() => runTaskAdvance({ to: 'close', dir })).not.toThrow()
    expect(phaseOf()).toBe('close')
    expect(() => runTaskAdvance({ to: 'complete', dir })).toThrow(/below.*L2/i)
    expect(phaseOf()).toBe('close')
  })

  it('verification → close rejects a missing gate-pass marker', () => {
    seedLegacy('verification')
    expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/missing.*gate-pass\.json/i)
    expect(phaseOf()).toBe('verification')
  })

  it('close → complete rejects a missing gate-pass marker', () => {
    seedLegacy('close')
    expect(() => runTaskAdvance({ to: 'complete', dir })).toThrow(/missing.*gate-pass\.json/i)
    expect(phaseOf()).toBe('close')
  })

  it('ARBITER_SKIP_GATE_MARKER bypasses the marker gate outside CI', () => {
    vi.stubEnv('ARBITER_SKIP_GATE_MARKER', '1')
    vi.stubEnv('CI', 'false')
    try {
      seedLegacy('verification')
      expect(() => runTaskAdvance({ to: 'close', dir })).not.toThrow()
      expect(phaseOf()).toBe('close')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ARBITER_SKIP_GATE_MARKER is refused under CI', () => {
    vi.stubEnv('ARBITER_SKIP_GATE_MARKER', '1')
    vi.stubEnv('CI', 'true')
    try {
      seedLegacy('verification')
      expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/missing.*gate-pass\.json/i)
      expect(phaseOf()).toBe('verification')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('plan-review gate path: advance to red with skipPlanReview succeeds', () => {
    seedLegacy('red-team-review')
    expect(() => runTaskAdvance({ to: 'red', dir, skipPlanReview: true })).not.toThrow()
  })
})
