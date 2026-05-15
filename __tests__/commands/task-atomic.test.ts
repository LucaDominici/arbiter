// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { writeTaskStatus } from '../../src/commands/task.js'

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

  it('merges timestamps on second write', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    writeTaskStatus({ taskDir, phase: 'implementation' })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      timestamps: Record<string, string>
    }
    expect(Object.keys(parsed.timestamps).length).toBeGreaterThanOrEqual(2)
  })
})
