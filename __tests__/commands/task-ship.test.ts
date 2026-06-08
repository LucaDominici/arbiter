// SPDX-License-Identifier: Apache-2.0
//
// `/ship` orchestrator sequencing (#1206): step computation + auto-advance over the existing engine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runTaskShip, shipSequence, shipStepFor, nextPhase } from '../../src/commands/task-ship.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'

// Gates that would otherwise require a real repo / model switch
vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({ modelSwitch: false, transcriptPath: null }),
}))
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
}))

function writeTddEvidence(dir: string, taskId: string): void {
  const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(
    join(evDir, `${taskId}.json`),
    JSON.stringify({
      $schemaVersion: 1,
      task_id: taskId,
      test_path: '__tests__/x.test.ts',
      test_commit_sha: 'a'.repeat(40),
      test_run_log: 'FAIL __tests__/x.test.ts\n✗ 1 test failed',
      observed_failure: 'FAIL __tests__/x.test.ts',
      recorded_at: '2026-06-04T00:00:00.000Z',
    }),
    'utf-8',
  )
}

describe('ship sequencing — pure plan', () => {
  it('shipSequence covers all eight forward phases in order', () => {
    const seq = shipSequence('Standard')
    expect(seq.map((s) => s.phase)).toEqual([
      'preflight',
      'plan',
      'red-team-review',
      'red',
      'green',
      'refactor',
      'verification',
      'complete',
    ])
  })

  it('dispatches tier-N red-team agents at red-team-review', () => {
    expect(shipStepFor('red-team-review', 'XS').reviewAgents).toBe(1)
    expect(shipStepFor('red-team-review', 'S').reviewAgents).toBe(2)
    expect(shipStepFor('red-team-review', 'Standard').reviewAgents).toBe(3)
  })

  it('dispatches tier-N code-review agents at refactor', () => {
    expect(shipStepFor('refactor', 'XS').reviewAgents).toBe(3)
    expect(shipStepFor('refactor', 'Standard').reviewAgents).toBe(4)
  })

  // #1260 — size (via tier) drives BOTH the review-agent COUNT and the orthogonal
  // VERTICAL breadth. This is the "drive, not print" proof: both fields move together.
  it('refactor step surfaces a vertical floor that WIDENS with tier (count + breadth)', () => {
    const xs = shipStepFor('refactor', 'XS')
    const s = shipStepFor('refactor', 'S')
    const std = shipStepFor('refactor', 'Standard')

    // breadth widens with size
    expect(s.verticals.length).toBeGreaterThan(xs.verticals.length)
    expect(std.verticals.length).toBeGreaterThan(s.verticals.length)
    expect(s.verticals).toEqual(expect.arrayContaining(xs.verticals))
    expect(std.verticals).toEqual(expect.arrayContaining(s.verticals))

    // count widens too (Standard refactor > XS refactor)
    expect(std.reviewAgents).toBeGreaterThan(xs.reviewAgents)

    // verticals are real auditor-routing names (not free text)
    expect(std.verticals).toContain('security')
    expect(std.verticals).toContain('data-integrity')
  })

  it('red-team-review step also carries the size-derived vertical floor', () => {
    expect(shipStepFor('red-team-review', 'Standard').verticals).toContain('security')
    expect(shipStepFor('red-team-review', 'XS').verticals).toEqual([
      'bugs',
      'type-safety',
      'domain',
    ])
  })

  it('nextPhase walks forward and stops at complete', () => {
    expect(nextPhase('plan')).toBe('red-team-review')
    expect(nextPhase('red-team-review')).toBe('red')
    expect(nextPhase('complete')).toBeNull()
  })
})

describe('ship orchestrator — drives a fixture end-to-end', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('seeds id/tier on first invocation and reports the preflight step', () => {
    const r = runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    expect(r.phase).toBe('preflight')
    expect(r.done).toBe(false)
    expect(readUnifiedState(dir)?.taskId).toBe('#1206')
    expect(readUnifiedState(dir)?.tier).toBe('Standard')
  })

  it('--advance from red-team-rework re-enters red-team-review (no silent stall)', () => {
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeUnifiedState(dir, { phase: 'red-team-rework' })
    const r = runTaskShip({ dir, advance: true })
    expect(r.advanced).toBe(true)
    expect(r.phase).toBe('red-team-review')
  })

  it('auto-advances phase-by-phase through gate-green to complete', () => {
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeTddEvidence(dir, '#1206')

    const visited: TaskPhase[] = ['preflight']
    let guard = 0
    let done = false
    while (!done && guard < 20) {
      const r = runTaskShip({ dir, advance: true, advanceOpts: { skipPlanReview: true } })
      visited.push(r.phase)
      done = r.done
      guard++
    }
    expect(done).toBe(true)
    expect(visited).toEqual([
      'preflight',
      'plan',
      'red-team-review',
      'red',
      'green',
      'refactor',
      'verification',
      'complete',
    ])
    expect(readUnifiedState(dir)?.phase).toBe('complete')
  })
})
