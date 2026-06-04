import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({
    modelSwitch: false,
    transcriptPath: null,
  }),
}))
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runTaskAdvance } from '../../src/commands/task.js'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'

describe('runTaskAdvance', () => {
  let dir: string

  const seed = (phase: TaskPhase) => writeUnifiedState(dir, { phase })
  const phaseOf = () => readUnifiedState(dir)?.phase

  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('happy path: preflight → plan advances phase in the unified document', () => {
    seed('preflight')
    runTaskAdvance({ to: 'plan', dir })
    expect(phaseOf()).toBe('plan')
  })

  it('happy path: plan → red-team-review → red advances phase', () => {
    seed('plan')
    runTaskAdvance({ to: 'red-team-review', dir })
    runTaskAdvance({ to: 'red', dir, skipPlanReview: true })
    expect(phaseOf()).toBe('red')
  })

  it('appends to log.md with ISO timestamp and prev → next', () => {
    seed('preflight')
    const before = new Date()
    runTaskAdvance({ to: 'plan', dir })
    const log = readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')
    expect(log).toContain('preflight → plan')
    expect(log).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    const ts = new Date(log.trim().split(' ')[1])
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('illegal skip: preflight → red fails', () => {
    seed('preflight')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/illegal.*skip|cannot advance/i)
  })

  it('backward transition blocked without --reverse', () => {
    seed('red')
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/backward.*--reverse|use --reverse/i)
  })

  it('--reverse allows backward transition', () => {
    seed('red')
    runTaskAdvance({ to: 'plan', dir, reverse: true })
    expect(phaseOf()).toBe('plan')
  })

  it('no-op when already at target phase', () => {
    seed('plan')
    expect(() => runTaskAdvance({ to: 'plan', dir })).not.toThrow()
    expect(phaseOf()).toBe('plan')
  })

  it('--reverse does not permit forward skip', () => {
    seed('preflight')
    expect(() => runTaskAdvance({ to: 'verification', dir, reverse: true })).toThrow(
      /illegal.*skip|cannot advance/i,
    )
  })

  it('unknown --to value throws', () => {
    seed('plan')
    expect(() => runTaskAdvance({ to: 'nonexistent' as never, dir })).toThrow(
      /unknown.*phase|invalid.*to/i,
    )
  })
})
