// SPDX-License-Identifier: Apache-2.0
// #2435 AC-1 — behavioural half of the phase-gate contract.
//
// `src/commands/task.ts` gated five of the ten reachable phases. Advancing into or out of
// `preflight`, `plan`, `red-team-review`, `refactor` and `red-team-rework` asserted nothing,
// so a ship could reach `verification` with no plan reviewed and no red team ever dispatched.
// The static ship.md-derived check lives in `__tests__/docs/ship-phase-gates-2435.test.ts`;
// this file proves the new entries actually refuse.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({ modelSwitch: false, transcriptPath: null }),
}))

import { runTaskAdvance } from '../../src/commands/task.js'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'

const dirs: string[] = []

function tmpRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'task-advance-gates-'))
  dirs.push(d)
  mkdirSync(join(d, '.claude'), { recursive: true })
  return d
}

function seed(dir: string, phase: TaskPhase, taskId = '#2435'): void {
  writeUnifiedState(dir, { phase, taskId })
}

function enablePlanReview(dir: string): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(join(dir, '.arbiter', 'plan-review.enabled'), '', 'utf-8')
}

function recordPlanReviewPass(dir: string, taskId = '#2435'): void {
  const evDir = join(dir, '.arbiter', 'evidence', 'plan-review', taskId.replace(/[^\w-]/g, '_'))
  mkdirSync(evDir, { recursive: true })
  writeFileSync(join(evDir, 'latest.json'), JSON.stringify({ verdict: 'PASS' }), 'utf-8')
}

function recordRedTeam(dir: string, taskId = '#2435'): void {
  const evDir = join(dir, '.arbiter', 'evidence', 'redteam')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(join(evDir, `${taskId}.json`), JSON.stringify({ findings: [] }), 'utf-8')
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('advance --to plan — preflight must actually have seeded task state (AC-1)', () => {
  it('refuses when no task id was ever seeded (AC-1)', () => {
    const dir = tmpRepo()
    writeUnifiedState(dir, { phase: 'preflight' })
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/task id/i)
  })

  it('advances once the task is seeded (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight')
    runTaskAdvance({ to: 'plan', dir })
    expect(readUnifiedState(dir)?.phase).toBe('plan')
  })
})

describe('advance --to red-team-review — the plan-review promise is asserted on EVERY exit from plan (AC-1)', () => {
  it('refuses when plan-review is enabled and no PASS verdict was recorded (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'plan')
    enablePlanReview(dir)
    expect(() => runTaskAdvance({ to: 'red-team-review', dir })).toThrow(/plan-review gate/)
  })

  it('advances once a PASS verdict exists (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'plan')
    enablePlanReview(dir)
    recordPlanReviewPass(dir)
    runTaskAdvance({ to: 'red-team-review', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red-team-review')
  })
})

describe('leaving red-team-review — the tier-N dispatch promise is asserted (AC-1)', () => {
  it('refuses to advance to red with no red-team evidence (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'red-team-review')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/red-team evidence/i)
  })

  it('refuses to advance to red-team-rework with no red-team evidence (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'red-team-review')
    expect(() => runTaskAdvance({ to: 'red-team-rework', dir })).toThrow(/red-team evidence/i)
  })

  it('advances to red once the evidence ship.md names exists (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'red-team-review')
    recordRedTeam(dir)
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('demands it on the red-team-rework → red exit too (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'red-team-rework')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/red-team evidence/i)
  })

  it('does not demand red-team evidence when the phase left is not a red-team phase (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'plan')
    runTaskAdvance({ to: 'red-team-review', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red-team-review')
  })
})

describe('advance --to refactor — the review machinery must have an id to key on (AC-1)', () => {
  it('refuses an id-less document, which would vacuous-pass review-completion (AC-1)', () => {
    const dir = tmpRepo()
    writeUnifiedState(dir, { phase: 'green' })
    expect(() => runTaskAdvance({ to: 'refactor', dir })).toThrow(/task id/i)
  })

  it('advances once the task is seeded (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'green')
    runTaskAdvance({ to: 'refactor', dir })
    expect(readUnifiedState(dir)?.phase).toBe('refactor')
  })
})
