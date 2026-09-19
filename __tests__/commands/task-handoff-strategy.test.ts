// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi } from 'vitest'
import { runTaskRecover } from '../../src/commands/task.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'

describe('cold recovery projects durable observations (#2724)', () => {
  it('reads the candidate and next action without history/network searches or mandatory clear', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-recover-'))
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const runner = vi.fn(() => {
      throw new Error('history must not be searched')
    })
    try {
      writeUnifiedState(dir, {
        taskId: '#2724',
        phase: 'refactor',
        plan: 'plan.md',
        review: { rounds: 1, lastReviewedSha: 'a'.repeat(40) },
        cursor: {
          lastAction: '39 targeted tests passed',
          nextAction: 'submit the final reviewer return',
        },
      })
      const path = join(dir, '.claude/.task/status.json')
      const before = readFileSync(path, 'utf8')
      runTaskRecover({ dir, runner })
      const text = output.mock.calls.flat().join('')
      expect(text).toContain('39 targeted tests passed')
      expect(text).toContain('submit the final reviewer return')
      expect(text).toContain('a'.repeat(40))
      expect(text).not.toContain('/clear')
      expect(runner).not.toHaveBeenCalled()
      expect(readFileSync(path, 'utf8')).toBe(before)
    } finally {
      output.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
