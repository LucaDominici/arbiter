// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { writeTaskStatus } from '../../src/commands/task.js'
import type { TaskStatus } from '../../src/commands/task.js'

describe('TaskStatus schema extension (#703) — handoff + cost fields', () => {
  let dir: string
  let taskDir: string

  beforeEach(() => {
    dir = createTestProject()
    taskDir = join(dir, '.claude', '.task-703')
    mkdirSync(taskDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function readStatus(): TaskStatus {
    return JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as TaskStatus
  }

  it('accepts handoffStrategy "interactive" in extras', () => {
    writeTaskStatus({ taskDir, phase: 'red', extras: { handoffStrategy: 'interactive' } })
    expect(readStatus().handoffStrategy).toBe('interactive')
  })

  it('accepts handoffStrategy "inline" in extras', () => {
    writeTaskStatus({ taskDir, phase: 'red', extras: { handoffStrategy: 'inline' } })
    expect(readStatus().handoffStrategy).toBe('inline')
  })

  it('accepts handoffStrategy null (no-switch host)', () => {
    writeTaskStatus({ taskDir, phase: 'red', extras: { handoffStrategy: null } })
    const status = readStatus()
    expect(status).toHaveProperty('handoffStrategy')
    expect(status.handoffStrategy).toBeNull()
  })

  it('accepts planningHandoffReady as ISO timestamp', () => {
    const iso = '2026-05-18T10:00:00.000Z'
    writeTaskStatus({ taskDir, phase: 'red', extras: { planningHandoffReady: iso } })
    expect(readStatus().planningHandoffReady).toBe(iso)
  })

  it('accepts postClearResumed as ISO timestamp', () => {
    const iso = '2026-05-18T10:05:00.000Z'
    writeTaskStatus({ taskDir, phase: 'red', extras: { postClearResumed: iso } })
    expect(readStatus().postClearResumed).toBe(iso)
  })

  it('accepts hostCapabilities object with modelSwitch + transcriptAvailable', () => {
    writeTaskStatus({
      taskDir,
      phase: 'red',
      extras: { hostCapabilities: { modelSwitch: true, transcriptAvailable: false } },
    })
    expect(readStatus().hostCapabilities).toEqual({ modelSwitch: true, transcriptAvailable: false })
  })

  it('accepts cost field with byPhase breakdown', () => {
    writeTaskStatus({
      taskDir,
      phase: 'green',
      extras: {
        cost: { byPhase: { red: { in: 12_000, out: 4_000, samples: 5 } } },
      },
    })
    const cost = readStatus().cost as {
      byPhase: Record<string, { in: number; out: number; samples: number }>
    }
    expect(cost.byPhase.red).toEqual({ in: 12_000, out: 4_000, samples: 5 })
  })

  it('merges handoff fields with existing timestamps across writes', () => {
    const iso = '2026-05-18T10:00:00.000Z'
    writeTaskStatus({ taskDir, phase: 'red', extras: { planningHandoffReady: iso } })
    writeTaskStatus({
      taskDir,
      phase: 'red',
      extras: { postClearResumed: '2026-05-18T10:05:00.000Z' },
    })
    const status = readStatus()
    expect(status.timestamps).toHaveProperty('red')
    expect(status.postClearResumed).toBe('2026-05-18T10:05:00.000Z')
  })

  it('status.json contains no PII (no email-pattern outside ISO timestamps)', () => {
    const iso = '2026-05-18T10:00:00.000Z'
    writeTaskStatus({
      taskDir,
      phase: 'red',
      extras: {
        handoffStrategy: 'interactive',
        planningHandoffReady: iso,
        hostCapabilities: { modelSwitch: true, transcriptAvailable: false },
      },
    })
    const raw = readFileSync(join(taskDir, 'status.json'), 'utf-8')
    const stripped = raw.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g, '')
    expect(stripped).not.toMatch(/@[a-zA-Z]/)
  })

  it('required base fields (phase, timestamps, runId, gateDecisions) survive handoff extras', () => {
    writeTaskStatus({ taskDir, phase: 'red', extras: { handoffStrategy: 'interactive' } })
    const status = readStatus()
    expect(status).toHaveProperty('phase', 'red')
    expect(status).toHaveProperty('timestamps')
    expect(status).toHaveProperty('runId')
    expect(status).toHaveProperty('gateDecisions')
    expect(Array.isArray(status.gateDecisions)).toBe(true)
  })
})
