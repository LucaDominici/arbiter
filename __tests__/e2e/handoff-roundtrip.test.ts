// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'

describe('cold native lifecycle resume (#2724)', () => {
  it('crosses plan to RED in a fresh Claude process, then reports without mutating', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-resume-cli-'))
    try {
      writeUnifiedState(dir, {
        taskId: '#2724',
        phase: 'plan',
        plan: 'plan.md',
        cursor: { nextAction: 'write the failing regression' },
      })
      const cli = resolve('dist/cli.js')
      const run = (...args: string[]) =>
        spawnSync(process.execPath, [cli, ...args, '--dir', dir], {
          encoding: 'utf8',
          env: { ...process.env, CLAUDECODE: '1' },
        })
      const advance = run('lifecycle', 'advance', '--to', 'red')
      expect(advance.status, advance.stdout + advance.stderr).toBe(0)
      expect(readUnifiedState(dir)?.phase).toBe('red')
      const path = join(dir, '.claude/.task/status.json')
      const before = readFileSync(path, 'utf8')
      const status = run('ship', '#2724')
      expect(status.status, status.stdout + status.stderr).toBe(0)
      expect(
        status.stdout,
        JSON.stringify({
          stderr: status.stderr,
          error: status.error?.message,
          signal: status.signal,
        }),
      ).toContain('write the failing regression')
      expect(readFileSync(path, 'utf8')).toBe(before)
      expect(run('lifecycle', 'advance', '--to', 'green').status).not.toBe(0)
      expect(run('ship', '--post-clear').status).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
