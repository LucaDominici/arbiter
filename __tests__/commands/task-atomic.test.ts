// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { writeTaskStatus, runTaskResume } from '../../src/commands/task.js'

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
    const tmpFiles = files.filter((f) => f.includes('.tmp.'))
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
})
