import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runTaskAdvance } from '../../src/commands/task.js'

describe('runTaskAdvance', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('happy path: preflight → plan writes .task-phase', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'preflight\n')
    runTaskAdvance({ to: 'plan', dir })
    const phase = readFileSync(join(dir, '.claude', '.task-phase'), 'utf-8').trim()
    expect(phase).toBe('plan')
  })

  it('happy path: plan → red-team-review → implementation writes .task-phase', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'plan\n')
    runTaskAdvance({ to: 'red-team-review', dir })
    runTaskAdvance({ to: 'implementation', dir })
    const phase = readFileSync(join(dir, '.claude', '.task-phase'), 'utf-8').trim()
    expect(phase).toBe('implementation')
  })

  it('appends to .task-phase-history with ISO timestamp and prev → next', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'preflight\n')
    const before = new Date()
    runTaskAdvance({ to: 'plan', dir })
    const history = readFileSync(join(dir, '.claude', '.task-phase-history'), 'utf-8')
    expect(history).toContain('preflight → plan')
    // Must contain an ISO timestamp
    expect(history).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    const ts = new Date(history.split(' ')[0])
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('illegal skip: preflight → implementation fails', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'preflight\n')
    expect(() => runTaskAdvance({ to: 'implementation', dir })).toThrow(
      /illegal.*skip|cannot advance/i,
    )
  })

  it('backward transition blocked without --reverse', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'implementation\n')
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/backward.*--reverse|use --reverse/i)
  })

  it('--reverse allows backward transition', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'implementation\n')
    runTaskAdvance({ to: 'plan', dir, reverse: true })
    const phase = readFileSync(join(dir, '.claude', '.task-phase'), 'utf-8').trim()
    expect(phase).toBe('plan')
  })

  it('no-op when already at target phase', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'plan\n')
    expect(() => runTaskAdvance({ to: 'plan', dir })).not.toThrow()
    const phase = readFileSync(join(dir, '.claude', '.task-phase'), 'utf-8').trim()
    expect(phase).toBe('plan')
  })

  it('--reverse does not permit forward skip', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'preflight\n')
    expect(() => runTaskAdvance({ to: 'complete', dir, reverse: true })).toThrow(
      /illegal.*skip|cannot advance/i,
    )
  })

  it('unknown --to value throws', () => {
    writeFileSync(join(dir, '.claude', '.task-phase'), 'plan\n')
    expect(() => runTaskAdvance({ to: 'nonexistent' as never, dir })).toThrow(
      /unknown.*phase|invalid.*to/i,
    )
  })
})
