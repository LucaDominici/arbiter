// SPDX-License-Identifier: Apache-2.0
// #2435 AC-3 — `arbiter task get` handed a fresh maintainer a phase read out of ANOTHER
// branch's state file (`.claude/.task/status.json` is a fixed, shared path). Silence there
// tells someone starting from a clean checkout that their task is already seeded.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

import { runTaskGet } from '../../src/commands/task.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'

const dirs: string[] = []

function tmpGitRepo(branch: string): string {
  const d = mkdtempSync(join(tmpdir(), 'task-get-foreign-'))
  dirs.push(d)
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: d })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: d })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: d })
  mkdirSync(join(d, '.claude'), { recursive: true })
  return d
}

/** Run `fn`, returning everything it wrote to stdout and stderr. */
function capture(fn: () => void): { out: string; err: string } {
  let out = ''
  let err = ''
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk)
    return true
  })
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk)
    return true
  })
  try {
    fn()
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
  }
  return { out, err }
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('runTaskGet — foreign task state (#2435 AC-3)', () => {
  it('warns loudly when the recorded branch is not the checked-out branch (AC-3)', () => {
    const dir = tmpGitRepo('task/#2435-mine')
    writeUnifiedState(dir, {
      taskId: '#2351',
      phase: 'preflight',
      branch: 'fix/2351-prepare-tolerant-git-config',
    })

    const { out, err } = capture(() => runTaskGet({ dir, field: 'phase' }))

    expect(err).toMatch(/WARNING/)
    expect(err).toContain('#2351')
    expect(err).toContain('fix/2351-prepare-tolerant-git-config')
    expect(err).toContain('task/#2435-mine')
    // the single-value stdout contract for shell consumers is unchanged
    expect(out).toBe('preflight\n')
  })

  it('stays silent when the recorded branch matches the checkout (AC-3)', () => {
    const dir = tmpGitRepo('task/#2435-mine')
    writeUnifiedState(dir, {
      taskId: '#2435',
      phase: 'green',
      branch: 'task/#2435-mine',
    })

    const { out, err } = capture(() => runTaskGet({ dir, field: 'phase' }))

    expect(err).toBe('')
    expect(out).toBe('green\n')
  })

  it('stays silent when the state records no branch at all (AC-3)', () => {
    const dir = tmpGitRepo('task/#2435-mine')
    writeUnifiedState(dir, { taskId: '#2435', phase: 'plan' })

    const { err } = capture(() => runTaskGet({ dir, field: 'phase' }))

    expect(err).toBe('')
  })

  it('stays silent outside a git work tree (AC-3)', () => {
    const d = mkdtempSync(join(tmpdir(), 'task-get-nogit-'))
    dirs.push(d)
    mkdirSync(join(d, '.claude'), { recursive: true })
    writeUnifiedState(d, { taskId: '#2351', phase: 'preflight', branch: 'some/other-branch' })

    const { err } = capture(() => runTaskGet({ dir: d, field: 'phase' }))

    expect(err).toBe('')
  })
})
