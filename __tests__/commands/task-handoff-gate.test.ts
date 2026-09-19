// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { runTaskAdvance } from '../../src/commands/task.js'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('plan admission without a handoff ritual (#2724)', () => {
  it.each(['plan', 'red-team-review', 'red-team-rework'])(
    'recovers %s without writing during the read, then admits RED',
    (phase) => {
      const dir = mkdtempSync(join(tmpdir(), 'arbiter-resume-'))
      dirs.push(dir)
      writeUnifiedState(dir, { taskId: '#2724', phase: 'plan' })
      const path = join(dir, '.claude/.task/status.json')
      const state = JSON.parse(readFileSync(path, 'utf8'))
      state.phase = phase
      writeFileSync(path, JSON.stringify(state))
      const before = readFileSync(path, 'utf8')
      vi.stubEnv('CLAUDECODE', '1')
      expect(readUnifiedState(dir)?.phase).toBe('plan')
      expect(readFileSync(path, 'utf8')).toBe(before)
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(join(dir, '.arbiter/plan-review.enabled'), '')
      runTaskAdvance({ dir, to: 'red' })
      expect(readUnifiedState(dir)?.phase).toBe('red')
      expect(readUnifiedState(dir)?.planningHandoffReady).toBeUndefined()
      expect(readUnifiedState(dir)?.postClearResumed).toBeUndefined()
      expect(() => runTaskAdvance({ dir, to: 'green' })).toThrow(/TDD|evidence/i)
    },
  )
})
