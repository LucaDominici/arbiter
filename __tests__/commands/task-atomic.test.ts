// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { writeTaskStatus, runTaskResume, runTaskAdvance } from '../../src/commands/task.js'

describe('writeTaskStatus — atomic write (#690)', () => {
  let dir: string
  let claudeDir: string
  let taskDir: string

  beforeEach(() => {
    dir = createTestProject()
    claudeDir = join(dir, '.claude')
    taskDir = join(claudeDir, '.task-test')
    mkdirSync(taskDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('writes status.json to the target directory', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    const statusPath = join(taskDir, 'status.json')
    expect(existsSync(statusPath)).toBe(true)
  })

  it('status.json contains required schema fields', () => {
    writeTaskStatus({ taskDir, phase: 'implementation' })
    const raw = readFileSync(join(taskDir, 'status.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).toHaveProperty('phase', 'implementation')
    expect(parsed).toHaveProperty('timestamps')
    expect(parsed).toHaveProperty('runId')
    expect(parsed).toHaveProperty('gateDecisions')
    expect(Array.isArray(parsed.gateDecisions)).toBe(true)
  })

  it('status.json runId is non-empty string', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      runId: string
    }
    expect(typeof parsed.runId).toBe('string')
    expect(parsed.runId.length).toBeGreaterThan(0)
  })

  it('leaves no .tmp files after successful write', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    const files = readdirSync(taskDir)
    const tmpFiles = files.filter((f) => f.includes('.tmp.') || f.includes('.arbiter-tmp-'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('accepts optional task field in extras', () => {
    writeTaskStatus({ taskDir, phase: 'plan', extras: { task: '#123' } })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      task: string
    }
    expect(parsed.task).toBe('#123')
  })

  it('merges timestamps on second write — both phases preserved', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    writeTaskStatus({ taskDir, phase: 'implementation' })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      timestamps: Record<string, string>
    }
    expect(parsed.timestamps).toHaveProperty('plan')
    expect(parsed.timestamps).toHaveProperty('implementation')
  })

  it('extras cannot overwrite required fields (phase, runId, gateDecisions)', () => {
    writeTaskStatus({
      taskDir,
      phase: 'plan',
      extras: { phase: 'complete', runId: 'injected', gateDecisions: ['fake'] },
    })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(parsed.phase).toBe('plan')
    expect(parsed.runId).not.toBe('injected')
    expect(Array.isArray(parsed.gateDecisions)).toBe(true)
    expect((parsed.gateDecisions as unknown[]).length).toBe(0)
  })
})

describe('runTaskResume — recovery table (#690)', () => {
  let dir: string
  let claudeDir: string

  beforeEach(() => {
    dir = createTestProject()
    claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('defaults to preflight recovery when .task-phase missing', () => {
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/preflight/i)
  })

  it('returns implementation recovery for implementation phase', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'implementation\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/implementation/i)
    expect(output).toMatch(/check-all/i)
  })

  it('prepends task ID header when .task-id exists', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'plan\n')
    writeFileSync(join(claudeDir, '.task-id'), '#456\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/Task: #456/)
  })

  it('does not crash when .task-id is absent', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'verification\n')
    expect(() => runTaskResume({ dir })).not.toThrow()
  })

  it('throws on corrupted phase value', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'not-a-real-phase\n')
    expect(() => runTaskResume({ dir })).toThrow(/Corrupted phase/)
  })

  it('returns red-team-review recovery action for red-team-review phase (#691)', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'red-team-review\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/red-team/i)
    expect(output).toMatch(/evidence\/redteam|redteam/)
  })

  it('returns red-team-rework recovery action for red-team-rework phase (#691)', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'red-team-rework\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/rework|critical|re-run plan/i)
  })
})

describe('writeTaskStatus — branch field (#690)', () => {
  let dir: string
  let taskDir: string

  beforeEach(() => {
    dir = createTestProject()
    taskDir = join(dir, '.claude', '.task-test')
    mkdirSync(taskDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('persists branch field from extras', () => {
    writeTaskStatus({ taskDir, phase: 'plan', extras: { branch: 'task/#689-r1-s-bundle' } })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      branch: string
    }
    expect(parsed.branch).toBe('task/#689-r1-s-bundle')
  })
})

describe('runTaskAdvance — red-team phases (#691)', () => {
  let dir: string
  let claudeDir: string

  beforeEach(() => {
    dir = createTestProject()
    claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function setPhase(phase: string) {
    writeFileSync(join(claudeDir, '.task-phase'), phase + '\n')
  }

  function readPhaseFile(): string {
    return readFileSync(join(claudeDir, '.task-phase'), 'utf-8').trim()
  }

  it('advances plan → red-team-review sequentially', () => {
    setPhase('plan')
    runTaskAdvance({ to: 'red-team-review', dir })
    expect(readPhaseFile()).toBe('red-team-review')
  })

  it('advances plan → red-team-rework (lateral — skips order check)', () => {
    setPhase('plan')
    runTaskAdvance({ to: 'red-team-rework', dir })
    expect(readPhaseFile()).toBe('red-team-rework')
  })

  it('exits red-team-rework → plan without --reverse (lateral exit)', () => {
    setPhase('red-team-rework')
    expect(() => runTaskAdvance({ to: 'plan', dir })).not.toThrow()
    expect(readPhaseFile()).toBe('plan')
  })

  it('exits red-team-rework → red-team-review without --reverse', () => {
    setPhase('red-team-rework')
    expect(() => runTaskAdvance({ to: 'red-team-review', dir })).not.toThrow()
    expect(readPhaseFile()).toBe('red-team-review')
  })

  it('sequential phases still enforce ordering when neither side is lateral', () => {
    setPhase('preflight')
    expect(() => runTaskAdvance({ to: 'implementation', dir })).toThrow(/Illegal skip/)
  })

  it('preflight → plan → red-team-review → implementation sequential chain works', () => {
    setPhase('preflight')
    runTaskAdvance({ to: 'plan', dir })
    runTaskAdvance({ to: 'red-team-review', dir })
    runTaskAdvance({ to: 'implementation', dir })
    expect(readPhaseFile()).toBe('implementation')
  })

  it('isValidPhase accepts red-team-rework (not in PHASE_ORDER)', () => {
    // Validated indirectly: advance to lateral phase succeeds without throwing "Invalid --to value"
    setPhase('plan')
    expect(() => runTaskAdvance({ to: 'red-team-rework', dir })).not.toThrow()
  })

  it('round-trip: write red-team-review phase → resume outputs matching recovery (#690)', () => {
    writeTaskStatus({
      taskDir: join(claudeDir, '.task-test'),
      phase: 'red-team-review',
    })
    setPhase('red-team-review')

    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }

    expect(output).toMatch(/red-team/i)
  })
})
